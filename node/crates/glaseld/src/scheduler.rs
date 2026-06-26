//! Computation scheduler. Phase-3 version: FIFO with dedup by computationId.
//! (§5.1 specifies a priority queue ordered by priorityFee/gates; the priority
//! ordering is a straightforward extension once the daemon reads those fields.)
use crate::chain::Task;
use alloy::primitives::B256;
use std::collections::{HashSet, VecDeque};

pub struct Scheduler {
    queue: VecDeque<Task>,
    seen: HashSet<B256>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            seen: HashSet::new(),
        }
    }

    pub fn enqueue(&mut self, task: Task) {
        if self.seen.insert(task.computation_id) {
            self.queue.push_back(task);
        }
    }

    pub fn next(&mut self) -> Option<Task> {
        self.queue.pop_front()
    }
}
