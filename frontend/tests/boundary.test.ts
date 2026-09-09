import { expect, it, vi } from "vitest";
import { BoundaryController } from "../src/deployments/hooks/boundary-controller";

it("loads after actual scrollbar movement and does not drain on data arrival", () => {
  const load = vi.fn();

  const boundary = new BoundaryController(load);

  boundary.update(50, false, true, false);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  expect(load).not.toHaveBeenCalled();
  boundary.moved(3000);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  expect(load).toHaveBeenCalledExactlyOnceWith("next");
  boundary.update(100, false, true, false);
  boundary.rangeChanged({ startIndex: 90, endIndex: 99 });
  expect(load).toHaveBeenCalledTimes(1);
});

it("retains one pending boundary direction during refresh and reconsiders it afterward", () => {
  const load = vi.fn();

  const boundary = new BoundaryController(load);

  boundary.update(50, true, true, true);
  boundary.moved(3000);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.reconsider();
  expect(load).not.toHaveBeenCalled();
  boundary.update(50, false, true, true);
  boundary.reconsider();
  boundary.reconsider();
  expect(load).toHaveBeenCalledExactlyOnceWith("next");
});

it("reconsiders the latest direction and discards a boundary the user left", () => {
  const load = vi.fn();

  const boundary = new BoundaryController(load);

  boundary.update(50, true, true, true);
  boundary.moved(3000);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.moved(-1000);
  boundary.rangeChanged({ startIndex: 20, endIndex: 30 });
  boundary.update(50, false, true, true);
  boundary.reconsider();
  expect(load).not.toHaveBeenCalled();
});

it("expires movement away from the boundary before later data shrinkage", () => {
  const load = vi.fn();
  const boundary = new BoundaryController(load);
  boundary.update(100, false, true, true);
  boundary.moved(500);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.update(50, false, true, true);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.reconsider();
  expect(load).not.toHaveBeenCalled();
});

it("discards deferred loading after the boundary changes and serializes adjacent loads", () => {
  const load = vi.fn();
  const boundary = new BoundaryController(load);
  boundary.update(50, true, true, true);
  boundary.moved(500);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.update(100, false, true, true);
  boundary.reconsider();
  expect(load).not.toHaveBeenCalled();
  boundary.update(50, true, true, true, load, true);
  boundary.moved(500);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.update(50, false, true, true);
  boundary.reconsider();
  expect(load).not.toHaveBeenCalled();
});

it("cancels queued movement and deferred loads when its window unmounts", () => {
  const load = vi.fn();
  const boundary = new BoundaryController(load);
  boundary.update(50, true, true, false);
  boundary.moved(100);
  boundary.rangeChanged({ startIndex: 40, endIndex: 49 });
  boundary.dispose();
  boundary.reconsider();
  expect(load).not.toHaveBeenCalled();
});
