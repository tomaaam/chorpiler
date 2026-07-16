# Chorpiler
> 2.0 Pre-Release WIP Version

[![Node.js CI](https://github.com/fstiehle/chorpiler/actions/workflows/node.js.yml/badge.svg)](https://github.com/fstiehle/chorpiler/actions/workflows/node.js.yml)
- A compiler to transform BPMN 2.0 models to efficient smart contract components, based on petri-net reductions.
- Current targets supported: Solidity Smart Contracts, [Algorand TEAL Contracts](https://github.com/fstiehle/chorpiler-algorandvm)(v1)

## Overview

Chorpiler is a tool to transform a BPMN choreography model into a Solidity smart contract that encodes the process. The contract will enforce the order of task execution, the authorisation (correct participant exeucting the task) based on bound blockchain-addresses, and data-based (XOR) decisions.
Chorpiler has additional tools that help with testing and interacting with such contracts. Chorpiler supports the following choreography elements.

| Element            | Supported  |
|--------------------|------------|
| Choreography tasks | ✔          |
| Events             | Start, End |
| Gateways           | XOR, EVENT, AND |
| Sub-Choreographies           | ✔ |
| Call-Choreographies           | ✔ |
| Case Variables  | ✔          |
| Looping behaviour  | ✔          |
| Uncontrolled flow merge  | ✔          |

I addition to choreographies, Chorpiler supports BPMN **process diagrams** and **collaboration diagrams**, which are translated onto the same internal representation (see [Multi-Model Support](#multi-model-support-process--collaboration-diagrams)).

## Usage

Install and use through [npm](https://www.npmjs.com/package/chorpiler).

```
npm install chorpiler
```

See below example.

Complete example usage to parse and generate.
```js
import * as fs from 'fs';
import chorpiler, { TriggerEncoding } from 'chorpiler';

const parser = new chorpiler.Parser();

const bpmnXML = fs.readFileSync(path.join(BPMN_PATH, 'xor.bpmn'));
// parse BPMN file into petri net
const iNet = await parser.fromXML(bpmnXML);

const contractGenerator = new chorpiler
.generators.sol.DefaultContractGenerator(iNet[0]);

// compile to smart contract
return contractGenerator.compile().then((gen) => {
  fs.writeFileSync(
    "Process.sol",
    gen.target,
    { flag: 'w+' }
  );
  console.log("Process.sol generated.");
  // log encoding of participants and tasks,
  // can also be written to a .json file
  console.log(TriggerEncoding.toJSON(gen.encoding));
})
.catch(err => console.error(err));
```

For usage see also the tests defined in `tests/compiler`. For usage of the resulting smart contracts also see `tests/output`.

### Case Variables & Data-Based Decisions

> TODO:
XOR Picture example plus corresponding XML code.

### Interacting with Contracts

> TODO: describe encodings and
isEnabled(), give VIM example

### Advanced: Tools to Help Testing Your Contracts
> TODO:
Simulator howto

### Beta: Sub-Choreographies & Call-Choreographies
> TODO:
Simulator howto

### Petri net generation

Our approach is based on the optimised translation technique presented in Garćıa-Bañuelos et al. [1]: a process model is converted into a Petri net, and
this net is reduced according to well-established equivalence rules. In the smart contract, the process state is then encoded as a bit array. Our approach is based on interaction Petri nets, which are a special kind of labelled Petri nets. Interaction Petri nets have been proposed as the formal basis for BPMN choreographies [2]. As labels, they store the initiator and respondent information, which are essential for the channel construction. After conversion, we apply the same reduction rules as in [1].

In contrast to [1], we must restrict enforcement to certain roles: only initiators are allowed to enforce tasks. Thus, in our approach, we can differentiate between manual and autonomous transitions. Manual transitions correspond to tasks that are initiated by a participant; these must be explicitly executed. Autonomous transitions are the remaining silent transitions. Converting a process model into a Petri net creates silent transitions. While most of them can be deleted through reduction, some can not be removed without creating infinite-loops [1]. These transitions must then be performed by the blockchain autonomously, given that the correct conditions are met. Consequently, these transitions are not bound to a role. The differentiation allows an efficient execution: if the conditions for a manual task are met, it is fired and terminated; further autonomous transitions may be fired, without requiring further manual transitions.

[1]: Garćıa-Bañuelos, L., Ponomarev, A., Dumas, M., Weber, I.: Optimized Execution
of Business Processes on Blockchain. In: BPM. Springer, Cham (2017) 130–146

[2]: Decker, G., Weske, M.: Local enforceability in interaction Petri nets. In: BPM.
Volume 4714 of LNCS., Springer, Cham (2007) 305–319

## Multi-Model Support: Process & Collaboration Diagrams

Chorpiler compiles all three BPMN diagram types. Process and collaboration diagrams are translated into the same Interaction Petri Net as choreographies, so the encoder and Solidity backend are reused unchanged.

- **Process diagrams**: tasks, start/end events, XOR/AND/event-based gateways, case variables. A process names no participants, so the parser assigns them according to an authorisation model (see below).
- **Collaboration diagrams**: multiple pools connected by message flows. A send task and its matching receive task are merged into one transition (initiator = sender, respondent = receiver); internal tasks are owned by their pool; a synthetic AND-split/join bridges the pools' separate start and end events.

### Authorisation models for process diagrams

Three participant models can be generated from the same diagram:

| Model | Participants | On-chain check |
|---|---|---|
| `SingleActor` (default) | one default participant | `msg.sender == participants[0]` on every task |
| `Open` | one default participant | none — any account may execute an enabled task |
| `LaneBased` | one per BPMN lane | each task checks its own lane's participant |

```js
import chorpiler, { AuthorizationMode } from 'chorpiler';

const parser = new chorpiler.Parser();
const iNets = await parser.fromXML(bpmnXML, AuthorizationMode.LaneBased);
const gen = new chorpiler.generators.sol.DefaultContractGenerator(iNets[0]);
const { target } = await gen.compile({ enforceAuthorization: true }); // false = Open
```

### Added Test Cases

Each case has a BPMN model, a conforming event log (a valid run, must complete),
and a non-conforming log (an invalid run, must be rejected).

### Process diagrams
| Scenario | BPMN model | Conforming log | Non-conforming log |
|---|---|---|---|
| Sequence + parallel (AND) | [process-and.bpmn](tests/input/bpmn/edgecases/shouldsucceed/process-and.bpmn) | [process_and.xes](tests/input/xes/process_and.xes) | [non_process_and.xes](tests/input/xes/nonconforming/non_process_and.xes) |
| Exclusive choice (XOR, both branches) | [process-xor.bpmn](tests/input/bpmn/edgecases/shouldsucceed/process-xor.bpmn) | [process_xor.xes](tests/input/xes/process_xor.xes) | [non_process_xor.xes](tests/input/xes/nonconforming/non_process_xor.xes) |
| Loop | [process-loop.bpmn](tests/input/bpmn/edgecases/shouldsucceed/process-loop.bpmn) | [process_loop.xes](tests/input/xes/process_loop.xes) | [non_process_loop.xes](tests/input/xes/nonconforming/non_process_loop.xes) |

### Collaboration diagrams
| Scenario | BPMN model | Conforming log | Non-conforming log |
|---|---|---|---|
| Two-way message exchange | [collaboration-simple.bpmn](tests/input/bpmn/edgecases/shouldsucceed/collaboration-simple.bpmn) | [Collaboration_1.xes](tests/input/xes/Collaboration_1.xes) | [non_Collaboration_1.xes](tests/input/xes/nonconforming/non_Collaboration_1.xes) |
| Internal tasks + two message flows | [collaboration-internal.bpmn](tests/input/bpmn/edgecases/shouldsucceed/collaboration-internal.bpmn) | [collab_2.xes](tests/input/xes/collab_2.xes) | [non_collab_2.xes](tests/input/xes/nonconforming/non_collab_2.xes) |

### Authorisation models (process diagrams)
- Fixture: [process-lanes.bpmn](tests/input/bpmn/process-lanes.bpmn)
- Tests: the **"Participant authorization models"** block in [generator.test.ts](tests/generator.test.ts) — generates single-actor, open, and lane-based from the same model and checks each guard.

### Where the cases run
- **Parsing** (BPMN → net): [parser.test.ts](tests/parser.test.ts) — auto-discovers the `shouldsucceed` fixtures.
- **Generation** (net → Solidity): [generator.test.ts](tests/generator.test.ts)
- **On-chain execution** (deploy on Hardhat, replay logs): [execution.test.ts](tests/execution.test.ts) — set `REPLAY_NON_CONFORMING = true` to also run the non-conforming logs.
- **Gas comparison** of the three authorisation models: [compare-auth.ts](tests/helpers/scripts/compare-auth.ts) — `npm run script/compare`
- **Interaction-net visualisation**: [visualize.ts](tests/helpers/scripts/visualize.ts) — `npm run script/viz -- <model.bpmn> [SingleActor|Open|LaneBased] [LR|TB]`

> **Naming note:** event logs and generated contracts are named after the
> internal process/collaboration `id`, not the `.bpmn` filename. For example
> `collaboration-simple.bpmn` has collaboration id `Collaboration_1` →
> `Collaboration_1.xes`; `collaboration-internal.bpmn` has id `collab_2` →
> `collab_2.xes`.
