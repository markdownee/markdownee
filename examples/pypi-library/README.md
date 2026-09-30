# Markdownee Python examples

Run synchronous and asynchronous extraction with the native
[Markdownee Python library](https://pypi.org/project/markdownee/).
Both examples use _HTTP fetching_, so no browser installation is needed.

- `main.py` exports a crawl into a fresh directory, prints its manifest and files,
  then fetches one page into a format map.
- `async_example.py` demonstrates `acrawl()` and `afetch()`.

## Run the examples

Use Python 3.12 or newer. From this example directory:

```bash
python -m pip install markdownee
python main.py
python async_example.py
```

The scripts print their output directories and extracted results. To select other
pages, pass their URLs as arguments:

```bash
python main.py https://docs.python.org/3/tutorial/introduction.html
python async_example.py \
  https://docs.python.org/3/tutorial/introduction.html \
  https://docs.python.org/3/tutorial/controlflow.html
```

`run.sh` builds and installs the local wheel in a fresh environment, then executes
both programs. It requires `uv` and Python 3.12 and prints the temporary artifact
and output directory:

```bash
./run.sh
```

The runner installs the exact Trafilatura Core dependency from PyPI. For local
Trafilatura Core changes, pass the path to its built wheel as the optional argument.
See [Python Help](https://www.markdownee.com/help/pypi/) for browser setup,
options, output formats, and language differences.
