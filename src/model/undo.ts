// Linear undo/redo log — mirrors tech-design §10. Holds the data ops applied this
// session as two stacks: `done` (applied, undoable) and `undone` (redoable). A fresh
// edit clears the redo branch. View-only ops never enter here (§10), and undo is
// session-only in v1 (open-questions.md). The log stores ops as plain data; applying
// the inverse / re-applying is the caller's job (model/document.ts), so this stays a
// pure, worker-portable container.

import type { Op } from './ops';

export class UndoLog {
  private readonly done: Op[] = [];
  private readonly undone: Op[] = [];

  /** Record a freshly applied op; a new edit discards the redo branch. */
  record(op: Op): void {
    this.done.push(op);
    this.undone.length = 0;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Move the last applied op onto the redo branch and return it (to invert + apply). */
  takeUndo(): Op | undefined {
    const op = this.done.pop();
    if (op) this.undone.push(op);
    return op;
  }
  /** Move the last undone op back onto the done branch and return it (to re-apply). */
  takeRedo(): Op | undefined {
    const op = this.undone.pop();
    if (op) this.done.push(op);
    return op;
  }
}
