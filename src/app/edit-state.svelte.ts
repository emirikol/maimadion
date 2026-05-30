// Interaction/edit state — mirrors tech-design §16. Owns the in-flight edit (whether
// editing, where the edit came from, and the buffer text) plus whether the
// define-constant dialog is open. Pure UI state: parsing the buffer into a value and
// routing it through the op seam is the controller's job, since that needs the active
// coordinate (view) and the document. Selection is the single active coordinate, held
// on the ViewState; richer 1-D/block selection arrives in M8.

export type EditSource = 'grid' | 'bar';

export class EditState {
  editing = $state(false);
  editSource = $state<EditSource>('grid');
  editBuffer = $state('');
  // Whether the "define a constant (fiber)" dialog is open (§14 FlatDialog).
  flatDialogOpen = $state(false);

  /** Enter edit mode with an initial buffer, from the grid or the formula bar. */
  begin(initial: string, source: EditSource): void {
    this.editBuffer = initial;
    this.editSource = source;
    this.editing = true;
  }
  /** Leave edit mode (after a commit or cancel); the buffer text is left as-is. */
  finish(): void {
    this.editing = false;
  }

  openDialog(): void {
    this.flatDialogOpen = true;
  }
  closeDialog(): void {
    this.flatDialogOpen = false;
  }
}
