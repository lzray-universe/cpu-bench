# GitHub Actions CPU Benchmark (≈30s)

This repo contains a cross‑platform CPU benchmarking workflow that:
- Detects CPU/OS/arch on the runner
- Builds a single C++17 binary with auto‑tuned flags (`-O3 -march=native` or MSVC `/O2 /arch:AVX2` when appropriate)
- Runs three short tests totaling ~30s by default:
  - **Single-core compute** (int + float ops)
  - **Multi-core compute** (uses all logical cores)
  - **Memory bandwidth** (parallel memcpy streaming)
- Emits **JSON** results, a **Markdown** summary, and posts to the GitHub job summary
- Uploads artifacts for each OS (Linux, macOS, Windows)

## Usage

1. Create a new GitHub repository and upload everything in this zip.
2. Enable GitHub Actions on the repo.
3. Run the workflow: **Actions → CPU Bench → Run workflow**.
4. See the run **Summary** tab for the Markdown table and download artifacts.

### Local build (optional)
```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release -j
# Linux/macOS:
./build/cpu_bench --time 30
# Windows (MSVC):
build\Release\cpu_bench.exe --time 30
```

### CLI Flags
- `--time <sec>` total target runtime (default: 30)
- `--single <sec>` override single-core test duration
- `--multi <sec>` override multi-core test duration
- `--mem <sec>` override memory test duration
- `--threads <N>` force thread count for multi-core/memory tests
- `--json <file>` write JSON output file
- `--md <file>` write Markdown summary

## Notes
- The numbers are relative indicators; GH Actions runners vary by host. Geometric mean aggregates the three tests.
- The binary uses **std::thread** (no OpenMP dependency) and will adapt to available cores.
- Memory test counts **bytes moved by memcpy** to estimate aggregated bandwidth (GB/s).

License: MIT
