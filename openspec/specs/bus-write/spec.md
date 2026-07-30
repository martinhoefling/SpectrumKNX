## Purpose

Defines how the main Send ("Write to bus") panel determines the datapoint type
(DPT) used to transcode a value before it is written to the KNX bus: the project
default, the user's per-GA override, its effect on the value input, and how to
return to the project default.

## Requirements

### Requirement: Project DPT is the default

When a group address is chosen in a Send-panel row, the panel SHALL prefill the
row's DPT from the loaded project's DPT for that group address, when the project
defines one.

#### Scenario: Prefill from project

- **WHEN** the user selects a group address that has a DPT in the loaded project
- **THEN** the row's DPT field shows that project DPT as its value

#### Scenario: No project DPT

- **WHEN** the user selects or types a group address that has no DPT in the
  project
- **THEN** the row's DPT field is empty and the user may enter one

### Requirement: DPT is editable per row

The Send panel SHALL let the user edit the DPT of a row, overriding the project
default for that row. The effective DPT of a row is the user's override when set,
otherwise the project default.

#### Scenario: Override the project DPT

- **WHEN** a row prefilled with project DPT `5.001` has its DPT changed to `5.010`
- **THEN** the row's effective DPT is `5.010`

#### Scenario: Override persists with the row

- **WHEN** the user has overridden a row's DPT and the panel is toggled closed
  and reopened
- **THEN** the row's overridden DPT is still shown (it persists with the row's
  other inputs)

### Requirement: Input widget follows the effective DPT

The row's value input widget SHALL be selected from the row's effective DPT, not
the project DPT: DPT main 1 SHALL offer On/Off, DPT main 10/11/19 SHALL offer the
time/date pickers, and any other (or empty) DPT SHALL offer the free-value input.

#### Scenario: Widget switches when DPT is overridden

- **WHEN** a row's DPT is changed from `5.010` to `1.001`
- **THEN** the value control changes to the On/Off buttons for DPT 1

#### Scenario: Widget reflects a date/time override

- **WHEN** a row's DPT is set to `10.001`
- **THEN** the value control becomes the time picker

### Requirement: Send uses the effective DPT

An immediate or scheduled send from a row SHALL transcode the value using the
row's effective DPT. When the effective DPT is unknown or empty, the send SHALL
surface the backend's validation error to the user inline, without silently
falling back to the project DPT.

#### Scenario: Send with an overridden DPT succeeds

- **WHEN** the user overrides a GA's DPT to `5.010`, enters `128`, and writes
- **THEN** the panel sends the value transcoded as DPT `5.010` (a value the
  project's `5.001` would have rejected)

#### Scenario: Unknown DPT reports an error

- **WHEN** the user enters a DPT the backend cannot transcode and writes
- **THEN** the row shows the backend's error message and no value is written

### Requirement: Reset to the project DPT

When a row's DPT has been overridden and the group address has a project DPT, the
panel SHALL offer a way to reset the row's DPT back to the project default.

#### Scenario: Reset restores the project DPT

- **WHEN** the user resets a row whose DPT was overridden from project `5.001`
- **THEN** the row's DPT field shows `5.001` again and the row is no longer
  overridden
