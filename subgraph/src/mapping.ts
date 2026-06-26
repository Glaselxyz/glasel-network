import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ComputationRequested,
  ComputationCompleted,
  ComputationFailed,
  ComputationChallenged,
  ComputationFinalized,
} from "../generated/ComputationCoordinator/ComputationCoordinator";
import { Computation, ProtocolStat } from "../generated/schema";

function stats(): ProtocolStat {
  let s = ProtocolStat.load("global");
  if (s == null) {
    s = new ProtocolStat("global");
    s.requested = BigInt.zero();
    s.completed = BigInt.zero();
    s.failed = BigInt.zero();
    s.challenged = BigInt.zero();
    s.finalized = BigInt.zero();
  }
  return s;
}

export function handleRequested(e: ComputationRequested): void {
  let c = new Computation(e.params.computationId);
  c.mxeId = e.params.mxeId;
  c.compDefId = e.params.compDefId;
  c.status = "Requested";
  c.encInputs = e.params.encInputs;
  c.deadline = BigInt.fromI32(e.params.deadline);
  c.requestedAt = e.block.timestamp;
  c.txHash = e.transaction.hash;
  c.save();

  let s = stats();
  s.requested = s.requested.plus(BigInt.fromI32(1));
  s.save();
}

export function handleCompleted(e: ComputationCompleted): void {
  let c = Computation.load(e.params.computationId);
  if (c == null) return;
  c.status = "Completed";
  c.resultCommitment = e.params.resultCommitment;
  c.callbackSucceeded = e.params.callbackSucceeded;
  c.completedAt = e.block.timestamp;
  c.save();

  let s = stats();
  s.completed = s.completed.plus(BigInt.fromI32(1));
  s.save();
}

export function handleFailed(e: ComputationFailed): void {
  let c = Computation.load(e.params.computationId);
  if (c == null) return;
  c.status = "Failed";
  c.save();

  let s = stats();
  s.failed = s.failed.plus(BigInt.fromI32(1));
  s.save();
}

export function handleChallenged(e: ComputationChallenged): void {
  let c = Computation.load(e.params.computationId);
  if (c == null) return;
  c.status = "Challenged";
  c.challengedAt = e.block.timestamp;
  let nodes = new Array<Bytes>();
  for (let i = 0; i < e.params.slashedNodes.length; i++) {
    nodes.push(e.params.slashedNodes[i]);
  }
  c.slashedNodes = nodes;
  c.save();

  let s = stats();
  s.challenged = s.challenged.plus(BigInt.fromI32(1));
  s.save();
}

export function handleFinalized(e: ComputationFinalized): void {
  let c = Computation.load(e.params.computationId);
  if (c == null) return;
  c.status = "Finalized";
  c.finalizedAt = e.block.timestamp;
  c.save();

  let s = stats();
  s.finalized = s.finalized.plus(BigInt.fromI32(1));
  s.save();
}
