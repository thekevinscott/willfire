# github-data-file-fetcher#3

The happy path, run live. Same pull request the integration suite replays
frozen — here nothing is mocked, so the prediction crosses the real API.

Guards the head SHA before asserting, so a moved subject fails as itself
rather than as a wrong check list.

Expected: `["CI Gate"]`.
