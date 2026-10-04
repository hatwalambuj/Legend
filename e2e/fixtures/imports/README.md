# E2E import fixtures (QA, C-Q6)

Small, hand-written exports used by `e2e/imports.spec.ts`. All titles are public film/TV metadata; no
personal data. Matching is against the demo catalogue (`movie:278`, `movie:238`, `tv:1396`).

- `letterboxd-diary.csv`: Letterboxd diary (UTF-8 BOM, quoted cells): 2 Shawshank watches (one rewatch),
  1 Godfather, 1 title not in the catalogue.
- `imdb-ratings.csv`: IMDb ratings export: Shawshank, Breaking Bad, 1 TV episode (not importable).

The oversize (> 10 MB) file is generated in the test, not stored here.
