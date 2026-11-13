import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WriteToBusPanel } from './WriteToBusPanel';

// Editable DPT in the Send panel (#342).

const IDLE = { state: 'idle' };

// GA whose project DPT is 5.001 (0–100 %) — the #342 case: 128 is out of range
// there, so the user must be able to override to 5.010 (0–255).
const TARGETS = [{ address: '1/2/3', name: 'Dimmer', main: 5, sub: 1 }];

function mockSend(routes: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    void init;
    if (url.includes('/api/knx/send/scheduled/status')) return { ok: true, json: async () => IDLE } as Response;
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return { ok: true, json: async () => body } as Response;
    }
    if (url.includes('/api/knx/send')) return { ok: true, json: async () => ({ status: 'sent' }) } as Response;
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const dptInput = (c: HTMLElement) => c.querySelector('input[aria-label="Datapoint type"]') as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', mockSend());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('the DPT field stays closed until the row has a group address', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  expect(dptInput(container)).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  expect(dptInput(container)).toBeEnabled();
});

test('clearing the group address closes the DPT suggestions and they stay closed', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  const address = screen.getByPlaceholderText('GA');
  fireEvent.change(address, { target: { value: '1/2/3' } });
  fireEvent.focus(dptInput(container));
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();

  fireEvent.change(address, { target: { value: '' } });
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();

  fireEvent.change(address, { target: { value: '1/2/3' } });
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();
});

test('the DPT suggestions sit with the field and name each type', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  const shell = container.querySelector('[data-dpt-field]') as HTMLElement;
  fireEvent.focus(input);
  const list = screen.getByRole('listbox', { name: 'Datapoint types' });
  const option = screen.getByRole('option', { name: /5\.001/ });
  expect(option).toHaveTextContent('Percent (%)');
  expect(screen.getByRole('option', { name: /5\.010/ })).toBeInTheDocument();
  // Bare Haupttyp for this GA's main, but not other mains' subtypes.
  const bareMain = [...list.querySelectorAll('[role="option"]')]
    .find(el => (el.textContent ?? '').trim().startsWith('5 ') || (el.textContent ?? '').trim() === '5'
      || /^\s*5(?!\.)/.test(el.textContent ?? ''));
  expect(bareMain).toBeTruthy();
  expect(screen.queryByRole('option', { name: /1\.001/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /9\.001/ })).not.toBeInTheDocument();
  expect(list).toContainElement(option);
  const rect = shell.getBoundingClientRect();
  expect(list.style.position).toBe('fixed');
  expect(list.style.left).toBe(`${rect.left}px`);
  expect(Number.parseFloat(list.style.top)).toBeCloseTo(rect.bottom + 4, 0);
});

test('opening the DPT suggestions highlights and reveals the current value', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  expect(input).toHaveValue('5.001');
  fireEvent.focus(input);
  const current = screen.getByRole('option', { name: /5\.001/ });
  expect(current).toHaveAttribute('aria-selected', 'true');
});

test('a GA with no project DPT offers every known DPT', () => {
  const { container } = render(
    <WriteToBusPanel
      targets={[{ address: '0/7/0', name: '', main: null, sub: null }]}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '0/7/0' } });
  expect(dptInput(container)).toHaveValue('');
  fireEvent.focus(dptInput(container));
  // Full catalog — not constrained to one main (and ^ so 11.001 ≠ 1.001).
  expect(screen.getByRole('option', { name: /^1\.001/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /^5\.001/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /^9\.001/ })).toBeInTheDocument();
});

test('picking a DPT that needs a value field focuses the DPT chevron', async () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.focus(input);
  fireEvent.mouseDown(screen.getByRole('option', { name: /5\.010/ }));
  expect(input).toHaveValue('5.010');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle datapoint type list' })).toHaveFocus());
  expect(screen.getByPlaceholderText(/Value/)).not.toHaveFocus();
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();
});

test('picking a button-only DPT focuses the DPT chevron', async () => {
  const { container } = render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Switch', main: 1, sub: 1 }]}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.focus(input);
  // Full catalog for main 1 — pick another boolean subtype.
  fireEvent.mouseDown(screen.getByRole('option', { name: /1\.002/ }));
  expect(input).toHaveValue('1.002');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle datapoint type list' })).toHaveFocus());
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();
});

test('focusing the DPT field selects the current value and keeps it after the Werthilfe opens', async () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  input.focus();
  expect(await screen.findByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  input.setSelectionRange(input.value.length, input.value.length);
  document.dispatchEvent(new Event('selectionchange'));
  await waitFor(() => {
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

test('an exact DPT key does not filter the list until the user types while open', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  expect(input).toHaveValue('5.001');
  fireEvent.focus(input);
  const list = screen.getByRole('listbox', { name: 'Datapoint types' });
  // Full main-5 list is visible despite the exact draft.
  expect(screen.getByRole('option', { name: /5\.010/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /5\.004/ })).toBeInTheDocument();
  fireEvent.change(input, { target: { value: '5.01' } });
  expect(list).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /5\.010/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /5\.004/ })).not.toBeInTheDocument();
});

test('the reset control sits inside the DPT field', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const shell = container.querySelector('[data-dpt-field]') as HTMLElement;
  expect(screen.queryByTitle(/Reset to project DPT/)).not.toBeInTheDocument();

  fireEvent.change(dptInput(container), { target: { value: '5.010' } });
  fireEvent.blur(dptInput(container));
  expect(screen.getByTitle('Reset to project DPT 5.001')).toBeInTheDocument();
  expect(shell.contains(screen.getByTitle('Reset to project DPT 5.001'))).toBe(true);
});

test('the DPT field shows the designation beside the key', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  expect(dptInput(container)).toHaveValue('5.001');
  const shell = container.querySelector('[data-dpt-field]') as HTMLElement;
  expect(shell).toContainElement(screen.getByText('Percent (%)'));
});

test('DPT prefills from the project when a GA is chosen', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  expect(dptInput(container)).toHaveValue('5.001');
  // Not overridden yet → no reset affordance.
  expect(screen.queryByTitle(/Reset to project DPT/)).not.toBeInTheDocument();
});

test('overriding the DPT changes the effective DPT and shows a reset affordance', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });

  fireEvent.change(dptInput(container), { target: { value: '5.010' } });
  fireEvent.blur(dptInput(container));
  expect(dptInput(container)).toHaveValue('5.010');
  expect(screen.getByTitle('Reset to project DPT 5.001')).toBeInTheDocument();
});

test('the write widget follows the overridden DPT (main 5 → 1 renders On/Off)', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  // main 5 → free-value input
  expect(screen.getByPlaceholderText(/Value/)).toBeInTheDocument();

  fireEvent.change(dptInput(container), { target: { value: '1.001' } });
  fireEvent.blur(dptInput(container));
  // main 1 → On/Off buttons, free-value input gone
  expect(screen.getByRole('button', { name: /^on$/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^off$/ })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Value/)).not.toBeInTheDocument();
});

test('changing the DPT main clears a stale value', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '50' } });
  expect(screen.getByPlaceholderText(/Value/)).toHaveValue('50');

  // 5.001 → 9.001: main changes (5 → 9), still a free-value widget, value cleared.
  fireEvent.change(dptInput(container), { target: { value: '9.001' } });
  fireEvent.blur(dptInput(container));
  expect(screen.getByPlaceholderText(/Value/)).toHaveValue('');
});

test('sending uses the overridden DPT (the #342 case: 128 as 5.010)', async () => {
  const fetchMock = mockSend({ '/api/knx/send': { status: 'sent' } });
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(dptInput(container), { target: { value: '5.010' } });
  fireEvent.blur(dptInput(container));
  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '128' } });
  fireEvent.click(screen.getByRole('button', { name: /Write/ }));

  await waitFor(() => expect(screen.getByLabelText(/written '128' to 1\/2\/3/)).toBeInTheDocument());
  const sendCall = fetchMock.mock.calls.find(
    ([u]) => String(u).includes('/api/knx/send') && !String(u).includes('scheduled'),
  );
  const body = JSON.parse((sendCall![1] as RequestInit).body as string);
  expect(body).toMatchObject({ address: '1/2/3', payload: 128, dpt: '5.010' });
});

test('an invalid DPT is discarded on blur and the project DPT stays', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.change(input, { target: { value: '5.999' } });
  fireEvent.blur(input);
  expect(input).toHaveValue('5.001');
  expect(screen.queryByTitle(/Reset to project DPT/)).not.toBeInTheDocument();
});

test('reset restores the project DPT and drops the override', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  fireEvent.change(dptInput(container), { target: { value: '5.010' } });
  fireEvent.blur(dptInput(container));

  fireEvent.click(screen.getByTitle('Reset to project DPT 5.001'));
  expect(dptInput(container)).toHaveValue('5.001');
  expect(screen.queryByTitle(/Reset to project DPT/)).not.toBeInTheDocument();
});

test('reset to project DPT closes an open DPT Werthilfe like a committed Eingabe', async () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.change(input, { target: { value: '5.010' } });
  fireEvent.blur(input);
  fireEvent.focus(input);
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  // Typed filter still open — reset must discard it and apply the project DPT.
  fireEvent.change(input, { target: { value: '5.01' } });
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Reset to project DPT 5.001'));
  expect(input).toHaveValue('5.001');
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle datapoint type list' })).toHaveFocus());
});

test('a free send value shows the DPT unit beside the value when known', () => {
  const { container } = render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Temp', main: 9, sub: 1 }]}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  expect(dptInput(container)).toHaveValue('9.001');
  expect(screen.queryByText('°C')).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText(/Value/), { target: { value: '21.5' } });
  const valueField = container.querySelector('[data-value-field]') as HTMLElement;
  const unit = screen.getByText('°C');
  expect(valueField).toContainElement(unit);
  // Unit is a flex sibling after the input, not absolutely pinned to the field edge.
  const valueInput = valueField.querySelector('input') as HTMLInputElement;
  expect(valueInput.nextElementSibling).toBe(unit);
  expect(valueInput).toHaveStyle({ textAlign: 'right' });
  expect(valueField).toHaveStyle({ width: '100%' });
});

test('a click anywhere in the DPT field opens the list', () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();

  fireEvent.mouseDown(screen.getByText('Percent (%)'));
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  expect(input).toHaveFocus();
});

test('Enter with the DPT list closed commits a bare main', () => {
  const { container } = render(
    <WriteToBusPanel
      targets={[{ address: '1/2/3', name: 'Switch', main: 1, sub: 1 }]}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  expect(screen.getByRole('button', { name: /^on$/ })).toBeInTheDocument();

  const input = dptInput(container);
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('1');
  expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Write/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^on$/ })).not.toBeInTheDocument();
});

test('Enter with an open DPT list picks the highlighted entry', async () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.focus(input);
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('5.001');
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle datapoint type list' })).toHaveFocus());
  expect(screen.getByPlaceholderText(/Value/)).not.toHaveFocus();
});

test('arrow keys commit the adjacent DPT and keep the list open', async () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).toHaveValue('5.004');
  expect(input).toHaveFocus();
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /5\.004/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('5.004');
  expect(screen.queryByRole('listbox', { name: 'Datapoint types' })).not.toBeInTheDocument();
  // Confirming the pick focuses the chevron (value field must not steal it).
  await waitFor(() => expect(screen.getByRole('button', { name: 'Toggle datapoint type list' })).toHaveFocus());
  expect(screen.getByPlaceholderText(/Value/)).not.toHaveFocus();
});

test('chevron arrow keys step the unfiltered DPT list with wrap and keep chevron focus', async () => {
  const { container } = render(<WriteToBusPanel targets={TARGETS} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('GA'), { target: { value: '1/2/3' } });
  const input = dptInput(container);
  const chevron = screen.getByRole('button', { name: 'Toggle datapoint type list' });
  expect(input).toHaveValue('5.001');
  chevron.focus();
  fireEvent.keyDown(chevron, { key: 'ArrowDown' });
  expect(input).toHaveValue('5.004');
  expect(screen.getByRole('listbox', { name: 'Datapoint types' })).toBeInTheDocument();
  await waitFor(() => expect(chevron).toHaveFocus());
  fireEvent.keyDown(chevron, { key: 'ArrowUp' });
  expect(input).toHaveValue('5.001');
  fireEvent.keyDown(chevron, { key: 'ArrowUp' });
  expect(input).toHaveValue('5'); // bare Haupttyp is first
  // Wrap past the first entry to the last option in the full list.
  fireEvent.keyDown(chevron, { key: 'ArrowUp' });
  const options = screen.getAllByRole('option');
  expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(chevron).toHaveFocus());

  // Typing filters the list; chevron stepping clears the filter and uses the full list.
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '5.01' } });
  expect(screen.queryByRole('option', { name: /5\.004/ })).not.toBeInTheDocument();
  chevron.focus();
  fireEvent.keyDown(chevron, { key: 'ArrowUp' });
  expect(screen.getByRole('option', { name: /5\.004/ })).toBeInTheDocument();
  await waitFor(() => expect(chevron).toHaveFocus());
});
