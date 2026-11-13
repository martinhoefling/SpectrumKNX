import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { useRetainFocusThroughDisabled } from './useRetainFocusThroughDisabled';

function Harness({ disabled }: { disabled: boolean }) {
  const { retainClickFocus } = useRetainFocusThroughDisabled(disabled);
  return (
    <button type="button" className="wtb-read-btn" disabled={disabled} onClick={retainClickFocus}>
      Read
    </button>
  );
}

function Controlled() {
  const [disabled, setDisabled] = useState(false);
  return (
    <>
      <Harness disabled={disabled} />
      <button type="button" onClick={() => setDisabled(true)}>disable</button>
      <button type="button" onClick={() => setDisabled(false)}>enable</button>
    </>
  );
}

describe('useRetainFocusThroughDisabled', () => {
  test('restores focus to the actuated control after a disable cycle', async () => {
    render(<Controlled />);
    const read = screen.getByRole('button', { name: /^Read$/i });
    fireEvent.click(read);
    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));
    expect(read).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Read$/i })).toHaveFocus());
  });
});
