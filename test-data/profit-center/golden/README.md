# Golden scenario companion data (key-aligned)

The files in `../input/` are the reference fixtures and are never edited. Their key values do not overlap:
CEPC has `S_PC_1` to `S_PC_3`, CEPCT only `DUMMY`, and CEPC_BUKRS only `P1PBP`, and CEPC rows 2 and 3 have a blank Client.
That is useful for testing warnings, but it cannot show a join or one-to-many generation.

This folder holds companion files made from the reference files for the end-to-end scenario (SPEC-029):

- `input/CEPC.csv`: the same three profit centers and columns, with the blank Client filled (`100`), and one deliberate defect: `S_PC_3` has the invalid date `13/45/26` in Valid From. The golden run uses it to show diagnostics, an error row in the errors file, and that a bad row does not stop the run.
- `input/CEPCT.csv`: one English text for each of the three profit centers.
- `input/CEPC_BUKRS.csv`: `S_PC_1` is assigned to `FI11`, `FI12` and `SE11`; `S_PC_2` to `FI11`; `S_PC_3` has none.
  This proves one-to-many generation (three rows for one profit center) and the zero-row case.

The field dictionary and the target workbook are the originals (`../input/field_dictionary.csv`, `../target/data_pc.XLSX`).
