import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { REGISTRY_PORT } from "../config";
import { request } from "http";
console.log("Registry server is starting...");

export type Node = { nodeId: number; pubKey: string };

export type RegisterNodeBody = {
  nodeId: number;
  pubKey: string;
};

export type GetNodeRegistryBody = {
  nodes: Node[];
};

const registeredNodes: Node[] = [];

export async function launchRegistry() {
  const _registry = express();
  _registry.use(express.json());
  _registry.use(bodyParser.json());

  // Implementing the /status route
  _registry.get("/status", (req: Request, res: Response): void => {
    res.send("live");
  });

  // Define a simple GET route to retrieve node information
  _registry.get("/nodes", (req: Request, res: Response): void => {
    res.json({ nodes: registeredNodes });
  });

  // Define a simple GET route to retrieve user information
  _registry.get("/users", (req: Request, res: Response): void => {
    res.json({ users: [] }); // Placeholder for user data
  });

  // Route to register a node
  _registry.post("/registerNode", (req: Request, res: Response): void => {
    const { nodeId, pubKey } = req.body;
    if (nodeId === undefined || typeof nodeId !== "number" || !pubKey) {
      res.status(400).json({ error: "Missing nodeId or public key" });
      return;
    }
    if (registeredNodes.some(node => node.nodeId === nodeId)) {
      res.status(400).json({ error: "Node is already registered" });
      return;
    }
    registeredNodes.push({ nodeId, pubKey });
    console.log(`Node ${nodeId} registered with publicKey: ${pubKey}`);
    
    res.json({ message: "Node registered successfully" });
  });
  

  // Route to retrieve all registered nodes (as required in 3.4)
  _registry.get("/getNodeRegistry", (req: Request, res: Response): void => {
    res.json({ nodes: registeredNodes });
  });

  const server = _registry.listen(REGISTRY_PORT, () => {
    console.log(`Registry is listening on port ${REGISTRY_PORT}`);
  });
  

  return server;
}

