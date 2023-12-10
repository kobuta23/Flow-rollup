import { ActionSchema, BatcherEvents, BuilderEvents, ExecutorEvents, FIFOStrategy, MicroRollup } from "@stackr/stackr-js";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { stackrConfig } from "../stackr.config";
import { FlowUpNetwork, flowupSTF } from "./state";
import { StateMachine } from "@stackr/stackr-js/execution";
const cors = require("cors");

// this file is generated by the deployment script
import * as genesisState from "../genesis-state.json";
import { fundRandomWallet, hexStrings, kick, signAndSend } from "../test/txTypes";
import { ethers } from "ethers";

const rollup = async () => {
  const flowupFsm = new StateMachine({
    state: new FlowUpNetwork(genesisState.state),
    stf: flowupSTF,
  });

  const actionSchemaType = {
    from: "String",
    type: {
      move: "String",
      stream: "String",
    },
    params: {
      move: {
        amount: "Uint",
      },
      stream: {
        flowRate: "Uint",
      },
      to: "String",
    },
    nonce: "Uint",
    actualTimestamp: "Uint",
  };

  // {
  //   from: string;
  //   type: {
  //     move?: "mint" | "burn" | "transfer";
  //     stream?: "create" | "update" | "delete";
  //   };
  //   params:{
  //     move?: {
  //       amount: number;
  //     };
  //     stream?: {
  //       flowRate?: number;
  //     };
  //     to: string;
  //   }
  //   nonce: number;
  //   actualTimestamp: number; // this is the timestamp of the block that the action is included in
  // }

  const actionInput = new ActionSchema("update-flowup", actionSchemaType);

  const buildStrategy = new FIFOStrategy();

  const { state, actions, events, chain } = await MicroRollup({
    config: stackrConfig,
    useState: flowupFsm,
    useAction: actionInput,
    useBuilder: { strategy: buildStrategy, autorun: true },
    useSyncer: { autorun: true },
  });
  
  return { state, actions, chain, events };
};

const app = express();
const corsOptions = {
  origin: true, // or true to allow any origin
  optionsSuccessStatus: 200,
};
app.options("*", cors(corsOptions)); // Enable pre-flight for all routes
app.use(cors(corsOptions));
app.use(bodyParser.json());
const { actions, state, chain, events } = await rollup();

// events.builder.onEvent(BuilderEvents.ORDER_BATCH, (batch) => {
//   console.log("$$: batch: ", batch);
//   console.log("$$: block here", Date.now());
// });

app.get("/", (req: Request, res: Response) => {
  // res.send({ allState: state.get().state.getState() });
  // return a nice HTML page with the state
  const allState = state.get().state.getState();
  let html = "<body><h1>FlowUp State</h1>";
  html += "<h2>Current localTimestamp: " + allState.localTimestamp + "</h2>";
  // add some CSS for the table so it's more digestible
  html += "<style>th {padding: 0px 15px} td {border: 1px solid black; padding: 5px; text-align:right}</style>";
  html += "<table>";
  html += "<tr><th>Address</th><th>BALANCE</th><th>Static Balance</th><th>Net Flow</th><th>Last Update</th><th>Liquidation In</th><th>Streams</th></tr>";
  allState.users.forEach((user) => {
    html += "<tr>";
    let formattedAddress = user.address.slice(0, 4) + '...' + user.address.slice(-4);
    html += "<td>" + formattedAddress + "</td>";
    html += "<td>" + (user.staticBalance + user.netFlow * (allState.localTimestamp - user.lastUpdate)) + "</td>";
    html += "<td>" + user.staticBalance + "</td>";
    html += "<td>" + user.netFlow + "</td>";
    html += "<td>" + user.lastUpdate + "</td>";
    html += "<td>" + (user.liquidationTime - allState.localTimestamp) + "</td>";
    html += "<td>";
    if(user.streams.length > 0){
      // add a subtable for streams
      html += "<table><tr><th>to</th><th>flowRate</th><th>startTime</th></tr>";
      user.streams.forEach((stream) => {
        let formattedAddress = stream.to.slice(0, 4) + '...' + stream.to.slice(-4);
        html += "<tr><td>" + formattedAddress + "</td><td>" + stream.flowRate + "</td><td>" + stream.startTime + "</td></tr>";
      }),
      html += "</table>";
    };
    html += "</td>";
    html += "</tr>";
  }
  );
  html += "</table>";
  html += "</body>";
  res.send(html);
});

// get endpoint for getting the state of a particular user
app.get("/:address", (req: Request, res: Response) => {
  const address = req.params.address;
  const allState = state.get().state.getState();
  console.log("$$: address: ", address);
  console.log("$$: allState: ", allState.users.length); 
  const user = allState.users.find((user) => user.address.trim().toLowerCase() == address.trim().toLowerCase());
  console.log("$$: found user: ", user);
  if (user) {
    const balance = user?.staticBalance + user?.netFlow * (Math.ceil((Date.now())/1000) - user?.lastUpdate);
    let result = {...user, balance};
    res.send({ result });
  } else {
    res.status(404).send({ message: "user not found" });
  }
});

app.post("/", async (req: Request, res: Response) => {
  const schema = actions.getSchema("update-flowup");

  if (!schema) {
    res.status(400).send({ message: "error" });
    return;
  }

  try {
    const actualTimestamp = Math.ceil((Date.now())/1000);
    console.log(req.body);
    //console.log("CURRENT TIME: ", actualTimestamp);
    //let actualTimestamp = req.body.payload.actualTimestamp;
    let newObj = { ...req.body.payload};
    newObj.actualTimestamp = actualTimestamp;
    req.body.payload = newObj;
    console.log(req.body);
    const newAction = schema.newAction(req.body);
    const ack = await actions.submit(newAction);
    res.status(201).send({ ack });
  } catch (e: any) {
    res.status(400).send({ error: e.message });
  }
});

app.listen(3000, () => {
  console.log("listening on port 3000");
});