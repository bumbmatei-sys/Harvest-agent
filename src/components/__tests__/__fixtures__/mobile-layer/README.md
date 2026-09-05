# Recorded sub-640px class layers

One JSON file per ticket. See
`src/components/__tests__/__fixtures__/mobile-layer-register.ts` for what each
field means and why the layer is stored in full rather than as a bare digest.

    THE-nnn.json
    {
      "ticket": "THE-nnn",
      "entries": [
        {
          "file": "src/components/PersonalInformationModal.tsx",
          "why": "<what moved on a phone and why it was safe — 80+ characters>",
          "digest": "<sha256 of the layer lines joined by \\n>",
          "layer": ["0\tdiv\t...", "1\tdiv\t...", "..."]
        }
      ]
    }

Rules, all of them enforced by `validateRegister()`:

* **Your ticket's file, nobody else's.** Adding `THE-nnn.json` conflicts with no
  other PR. Appending to another ticket's file is not the append path.
* **Never overwrite the baseline fixture** (`*.mobile-layer.json`). Making that
  edit unnecessary is the whole reason this directory exists.
* **The digest must be the digest of the layer beside it.** A record whose prose
  and classes have drifted apart is a hard failure, not a warning.
* **A reason under 80 characters is refused.** "cleanup" is not a record.

This directory is empty of records on THE-323, and that is correct: THE-323
builds the append path and moves no phone rendering. Do not add an entry in
advance or to unblock — an entry whose layer no component renders buys nothing
and is dead weight a later reader has to disprove.
