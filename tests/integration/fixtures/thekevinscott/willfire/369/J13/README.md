J13: how a reusable caller's name segment is formed, and where the 100-character cap applies.

Run 36429562958. A matrix caller with no `name:` appends the parenthetical to the caller segment (`mx (a) / leaf-a`); a literal `name:` keeps it (`fixed label (b) / leaf-b`); a `name:` holding an expression suppresses it (`m a / leaf-a`).

The caller segment is never cut: a 130-character `name:` dispatched a 139-character check name in full. The cap is a leaf rule, and this run pins its boundary — job names of 99 and 100 characters dispatched unchanged, 101 came back as 97 characters plus an ellipsis.
