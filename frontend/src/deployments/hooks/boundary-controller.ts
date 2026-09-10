/** Only measured movement may load adjacent pages; arriving data must not drain cursors. */
import type { ListRange } from "react-virtuoso";

type Direction = "next" | "previous";

export class BoundaryController {
  private range: ListRange = { startIndex: 0, endIndex: 0 };
  private movement?: Direction;
  private pending?: Direction;
  private busy = false;
  private restoring = false;
  private adjacent = false;
  private count = 0;
  private next = false;
  private previous = false;

  constructor(private load?: (direction: Direction) => void) {}

  update(
    count: number,
    busy: boolean,
    next: boolean,
    previous: boolean,
    load = this.load,
    adjacent = false,
  ) {
    // Unevaluated movement belongs to the old layout, never to arriving data.
    if (count !== this.count) {
      this.movement = undefined;
    }

    this.load = load;
    this.count = count;
    this.busy = busy;
    this.adjacent = adjacent;
    this.next = next;
    this.previous = previous;
  }

  moved(delta: number) {
    if (delta === 0) {
      return;
    }

    this.movement = delta > 0 ? "next" : "previous";
    this.pending = undefined;
  }

  rangeChanged(range: ListRange) {
    this.range = range;
    this.reconsider();
  }

  dispose() {
    this.load = undefined;
    this.movement = undefined;
    this.pending = undefined;
  }

  positioning(active: boolean) {
    this.restoring = active;
    if (!active) {
      this.reconsider();
    }
  }

  reconsider() {
    if (this.restoring) {
      return;
    }

    const direction = this.movement ?? this.pending;

    this.movement = undefined;
    this.pending = undefined;
    if (!direction || this.count === 0) {
      return;
    }

    const atBoundary =
      direction === "next"
        ? this.next && this.range.endIndex >= this.count - 1
        : this.previous && this.range.startIndex === 0;

    if (!atBoundary) {
      return;
    }

    if (this.busy) {
      // Refresh may change the boundary, so reconsider one pending direction afterward.
      // An adjacent load already consumes movement; queueing it would drain pages.
      if (!this.adjacent) {
        this.pending = direction;
      }

      return;
    }

    this.load?.(direction);
  }
}
