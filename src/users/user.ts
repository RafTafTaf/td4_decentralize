import bodyParser from "body-parser";
import express from "express";
import { BASE_USER_PORT, BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import { createRandomSymmetricKey, exportSymKey, rsaEncrypt, symEncrypt } from "../crypto";
import { Node } from "../registry/registry";

declare global {
  var userStates: Record<number, { 
    lastReceivedMessage: string | null;
    lastSentMessage: string | null;
    lastCircuit: number[] | null;
  }>;
}

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  // Initializing global states
  if (!globalThis.userStates) {
    globalThis.userStates = {};
  }
  if (!globalThis.userStates[userId]) {
    globalThis.userStates[userId] = {
      lastReceivedMessage: null,
      lastSentMessage: null,
      lastCircuit: null
    };
  }

  // Status route
  _user.get("/status", (req, res) => {
    res.send("live");
  });

  // Retrieve last received message
  _user.get("/getLastReceivedMessage", (req, res) => {
    res.json({ result: globalThis.userStates[userId].lastReceivedMessage });
  });

  // Retrieve last sent message
  _user.get("/getLastSentMessage", (req, res) => {
    res.json({ result: globalThis.userStates[userId].lastSentMessage });
  });

  // Retrieve last circuit used
  _user.get("/getLastCircuit", (req, res) => {
    res.json({ result: globalThis.userStates[userId].lastCircuit });
  });

  // Route to receive a message
  _user.post("/message", (req, res) => {
    try {
      const { message } = req.body;

      // Allow empty messages but reject undefined or null
      if (message === undefined || message === null) {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log(`[User ${userId}] Received message: ${message.length === 0 ? "<EMPTY MESSAGE>" : message}`);

      globalThis.userStates[userId].lastReceivedMessage = message;
      return res.send("success");
    } catch (error) {
      console.error("Error handling message:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  _user.post("/sendMessage", async (req, res) => {
    try {
      const { message, destinationUserId } = req.body;

      if (message === undefined || destinationUserId === undefined) {
        console.log("MessageContent and recipientUserId are required")
        return res.status(400).json({ error: "MessageContent and recipientUserId are required" });
      }

      console.log(`[User ${userId}] Sending message: "${message}" to User ${destinationUserId}`);

      // Get the list of registered nodes from the registry
      const registryFetch = await fetch(`http://localhost:${REGISTRY_PORT}/getNodeRegistry`);
      const nodeRegistry = await registryFetch.json() as { nodes: Node[] };
      const nodesList = nodeRegistry.nodes;

      if (nodesList.length < 3) {
        return res.status(500).json({ error: "Insufficient nodes in the network" });
      }

      // Select 3 distinct random nodes
      const randomizedNodes = [...nodesList].sort(() => Math.random() - 0.5).slice(0, 3);
      const routingPath = randomizedNodes.map(node => node.nodeId);

      console.log(`[User ${userId}] New circuit generated:`, routingPath);

      // Generate a unique symmetric key for each node in the circuit
      const secureKeys = await Promise.all(routingPath.map(() => createRandomSymmetricKey()));

      // Apply multi-layer encryption (like an onion)
      let encodedMessage = message;

      for (let i = 2; i >= 0; i--) {
        const nextTarget = i === 2 
          ? (BASE_USER_PORT + destinationUserId).toString() 
          : (BASE_ONION_ROUTER_PORT + routingPath[i + 1]).toString();

        const formattedTarget = nextTarget.padStart(10, "0");
        encodedMessage = await symEncrypt(secureKeys[i], formattedTarget + encodedMessage);

        const symKeyBase64 = await exportSymKey(secureKeys[i]);
        const encryptedSymKey = await rsaEncrypt(symKeyBase64, randomizedNodes[i].pubKey);

        encodedMessage = encryptedSymKey + encodedMessage;
      }

      // Send the message to the first node in the circuit
      const firstHopNode = routingPath[0];
      const firstHopUrl = `http://localhost:${BASE_ONION_ROUTER_PORT + firstHopNode}/message`;

      console.log(`[User ${userId}] Forwarding encrypted message to node ${firstHopNode}:`, firstHopUrl);

      const transmissionResponse = await fetch(firstHopUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: encodedMessage }),
      });

      if (!transmissionResponse.ok) {
        throw new Error(`Failed to send message to first node: ${transmissionResponse.status}`);
      }

      // Updating the user's state after a successful message send
      globalThis.userStates[userId].lastSentMessage = message;
      globalThis.userStates[userId].lastCircuit = routingPath;

      return res.json({ status: "Message successfully transmitted" });

    } catch (error) {
      console.error(`[User ${userId}] Error while transmitting message:`, error);
      return res.status(500).json({ error: "Internal error occurred during message transmission" });
    }
  });

  // Start the user server
  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(`User ${userId} is listening on port ${BASE_USER_PORT + userId}`);
  });

  return server;
}
