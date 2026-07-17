import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TimeBrush } from './TimeBrush';

const minTime = 1784368800000; // 2026-07-18T10:00:00.000Z
const maxTime = 1784372400000; // 2026-07-18T11:00:00.000Z
const initialVal: [number, number] = [minTime + 1000000, maxTime - 1000000];

test('renders TimeBrush, handles middle click and drags to pan', () => {
  const onChangeMock = vi.fn();
  
  const { container } = render(
    <TimeBrush
      minTime={minTime}
      maxTime={maxTime}
      value={initialVal}
      onChange={onChangeMock}
      telegrams={[]}
    />
  );

  expect(screen.getByText('Pan & Zoom Timeline')).toBeInTheDocument();

  // Find container div that has clientWidth/getBoundingClientRect mocked
  const track = container.querySelector('div[style*="position: relative"]');
  expect(track).toBeTruthy();
  
  // Mock bounding rect
  track!.getBoundingClientRect = () => ({
    width: 500,
    left: 0,
    right: 500,
    top: 0,
    bottom: 30,
    height: 30,
    x: 0,
    y: 0,
    toJSON: () => {},
  });

  const middle = container.querySelector('div[style*="cursor: grab"]');
  expect(middle).toBeTruthy();

  // Trigger drag start
  fireEvent.mouseDown(middle!, { clientX: 200, button: 0 });
  
  // Drag to the right
  fireEvent.mouseMove(window, { clientX: 250 });
  
  // Assert onChange is called with increased range
  expect(onChangeMock).toHaveBeenCalled();
  const nextVal = onChangeMock.mock.calls[0][0];
  expect(nextVal[0]).toBeGreaterThan(initialVal[0]);
  expect(nextVal[1]).toBeGreaterThan(initialVal[1]);

  // Release drag
  fireEvent.mouseUp(window);
});
