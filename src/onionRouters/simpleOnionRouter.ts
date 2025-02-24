import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, BASE_USER_PORT, REGISTRY_PORT } from "../config";
import { generateRsaKeyPair, exportPubKey, exportPrvKey, rsaDecrypt, symDecrypt } from "../crypto";
import { request } from "http";
import { webcrypto } from "crypto";

declare global {
  var nodeKeys: Record<number, { publicKey: webcrypto.CryptoKey; privateKey: webcrypto.CryptoKey }>;
  var nodeStates: Record<number, { 
    lastReceivedEncryptedMessage: string | null;
    lastReceivedDecryptedMessage: string | null;
    lastMessageDestination: number | null;
  }>;
}

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  // Initialisation des clés et de l'état du nœud
  if (!globalThis.nodeKeys) {
    globalThis.nodeKeys = {};
  }
  if (!globalThis.nodeKeys[nodeId]) {
    globalThis.nodeKeys[nodeId] = await generateRsaKeyPair();
  }

  if (!globalThis.nodeStates) {
    globalThis.nodeStates = {};
  }
  if (!globalThis.nodeStates[nodeId]) {
    globalThis.nodeStates[nodeId] = {
      lastReceivedEncryptedMessage: null,
      lastReceivedDecryptedMessage: null,
      lastMessageDestination: null,
    };
  }

  const { publicKey, privateKey } = globalThis.nodeKeys[nodeId];
  const publicKeyBase64 = await exportPubKey(publicKey);
  const privateKeyBase64 = await exportPrvKey(privateKey);

  // Enregistrement automatique du nœud auprès du registre
  const postData = JSON.stringify({ nodeId, pubKey: publicKeyBase64 });
  const req = request(
    {
      hostname: "localhost",
      port: REGISTRY_PORT,
      path: "/registerNode",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log(`Node ${nodeId} registered successfully.`);
        } else {
          console.error("Failed to register node, status code:", res.statusCode, data);
        }
      });
    }
  );

  req.on("error", (error) => {
    console.error("Failed to register node:", error);
  });

  req.write(postData);
  req.end();

  // Route de statut
  onionRouter.get("/status", (req, res) => {
    res.send("live");
  });

  // Routes d'accès aux messages
  onionRouter.get("/getLastReceivedEncryptedMessage", (req, res) => {
    res.json({ result: globalThis.nodeStates[nodeId].lastReceivedEncryptedMessage });
  });

  onionRouter.get("/getLastReceivedDecryptedMessage", (req, res) => {
    res.json({ result: globalThis.nodeStates[nodeId].lastReceivedDecryptedMessage });
  });

  onionRouter.get("/getLastMessageDestination", (req, res) => {
    res.json({ result: globalThis.nodeStates[nodeId].lastMessageDestination });
  });

  // Récupération de la clé privée
  onionRouter.get("/getPrivateKey", (req, res) => {
    res.json({ result: privateKeyBase64 });
  });

  // Route pour recevoir et transmettre des messages
  onionRouter.post("/message", async (req, res) => {
    try {
        const { message }: { message: string } = req.body;

        if (message === undefined) {  // Accept empty string but reject undefined
            return res.status(400).json({ error: "Missing message" });
        }

        console.log(`[Node ${nodeId}] Message received, decrypting...`);

        // Extract the encrypted symmetric key and the rest of the message
        const encryptedSymKey = message.slice(0, 344);
        const restOfMessage = message.slice(344);

        // Decrypt the symmetric key with the node's private key
        const symKey = await rsaDecrypt(encryptedSymKey, privateKey);

        // If restOfMessage is empty, it means we're at the last node/user
        let decryptedMessage = restOfMessage.length > 0 ? await symDecrypt(symKey, restOfMessage) : "";

        // Extract next destination (first 10 chars) and the actual message
        const nextDestination = decryptedMessage.length >= 10
            ? parseInt(decryptedMessage.slice(0, 10), 10)
            : null;

        const nextMessage = decryptedMessage.length > 10 ? decryptedMessage.slice(10) : "";

        console.log(`[Node ${nodeId}] Next destination: ${nextDestination !== null ? nextDestination : "Final Destination"}`);
        console.log(`[Node ${nodeId}] Decrypted message: ${nextMessage.length === 0 ? "<EMPTY MESSAGE>" : nextMessage}`);
        if (nextMessage === "") {
          console.log(`[Node ${nodeId}] Next message is empty, but will still be forwarded.`);
        }
      
        // Store decrypted message, even if empty
        globalThis.nodeStates[nodeId].lastReceivedEncryptedMessage = message;
        globalThis.nodeStates[nodeId].lastReceivedDecryptedMessage = nextMessage;
        globalThis.nodeStates[nodeId].lastMessageDestination = nextDestination;

        // If there is no next destination, deliver final message to the user
        if (nextDestination === null) {
            console.log(`[Node ${nodeId}] Final message reached, no further forwarding.`);
            return res.json({ status: "Final message reached the last node", message: nextMessage });
        }

        // Determine if the next destination is a User or another Node
        const isUser = nextDestination >= BASE_USER_PORT;
        const nextUrl = `http://localhost:${nextDestination}/message`;

        console.log(`[Node ${nodeId}] Forwarding message to ${isUser ? "User" : "Node"} at ${nextUrl}`);

        // Forward message to next destination
        const response = await fetch(nextUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: nextMessage }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        return res.json({ status: "Message decrypted and forwarded successfully" });

    } catch (error) {
        console.error(`[Node ${nodeId}] Error while decrypting the message:`, error);
        return res.status(500).json({ error: "Internal error while processing the message" });
    }
  });

  

  // Démarrer le serveur du nœud
  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(`Onion router ${nodeId} is listening on port ${BASE_ONION_ROUTER_PORT + nodeId}`);
  });

  return server;
}
