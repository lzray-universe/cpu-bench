#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <functional>
#include <future>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <numeric>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
  #include <windows.h>
  #define POPEN _popen
  #define PCLOSE _pclose
#else
  #include <unistd.h>
  #define POPEN popen
  #define PCLOSE pclose
#endif

using clk = std::chrono::steady_clock;
using secd = std::chrono::duration<double>;

struct TestResult {
    double seconds = 0.0;
    double gops_int = 0.0;   // billions of integer ops/s (estimated)
    double gflops = 0.0;     // billions of float ops/s (estimated)
    double gbps = 0.0;       // memory bandwidth (GB/s), when applicable
};

struct AllResults {
    std::string timestamp;
    std::string os;
    std::string arch;
    std::string cpu_name;
    unsigned threads = std::thread::hardware_concurrency();
    TestResult single_core;
    TestResult multi_core;
    TestResult memory_bw;
    double geometric_mean = 0.0; // geometric mean of (single_core mix, multi_core mix, memory)
};

static std::string run_cmd(const char* cmd) {
    std::string out;
    FILE* pipe = POPEN(cmd, "r");
    if (!pipe) return out;
    char buf[256];
    while (fgets(buf, sizeof(buf), pipe)) out += buf;
    PCLOSE(pipe);
    // trim
    out.erase(out.find_last_not_of(" \r\n\t")+1);
    while (!out.empty() && (out[0]==' '||out[0]=='\r'||out[0]=='\n'||out[0]=='\t')) out.erase(out.begin());
    return out;
}

static std::string detect_os() {
#if defined(_WIN32)
    return "Windows";
#elif defined(__APPLE__)
    return "macOS";
#elif defined(__linux__)
    return "Linux";
#else
    return "Unknown";
#endif
}

static std::string detect_arch() {
#if defined(_M_X64) || defined(__x86_64__)
    return "x86_64";
#elif defined(_M_ARM64) || defined(__aarch64__)
    return "arm64";
#elif defined(_M_IX86) || defined(__i386__)
    return "x86";
#else
    return "Unknown";
#endif
}

static std::string detect_cpu_name() {
#if defined(_WIN32)
    std::string n = run_cmd("wmic cpu get name");
    if (!n.empty()) {
        // remove header "Name"
        auto pos = n.find('\n');
        if (pos != std::string::npos) n = n.substr(pos+1);
        // collapse spaces
        std::string out;
        bool insp = false;
        for (char c : n) {
            if (c==' ' || c=='\t' || c=='\r') { if (!insp) { out.push_back(' '); insp=true; } }
            else { insp=false; out.push_back(c); }
        }
        return out;
    }
    return "Windows CPU";
#elif defined(__APPLE__)
    std::string n = run_cmd("sysctl -n machdep.cpu.brand_string");
    if (!n.empty()) return n;
    return "Apple CPU";
#elif defined(__linux__)
    // try /proc/cpuinfo
    std::ifstream fin("/proc/cpuinfo");
    std::string line;
    while (std::getline(fin, line)) {
        auto pos = line.find("model name");
        if (pos != std::string::npos) {
            auto colon = line.find(':');
            if (colon != std::string::npos) {
                std::string v = line.substr(colon+1);
                // trim
                v.erase(0, v.find_first_not_of(" \t"));
                v.erase(v.find_last_not_of(" \t\r\n")+1);
                return v;
            }
        }
        // for ARM
        pos = line.find("Hardware");
        if (pos != std::string::npos) {
            auto colon = line.find(':');
            if (colon != std::string::npos) {
                std::string v = line.substr(colon+1);
                v.erase(0, v.find_first_not_of(" \t"));
                v.erase(v.find_last_not_of(" \t\r\n")+1);
                return v;
            }
        }
    }
    std::string lscpu = run_cmd("lscpu | sed -n 's/^Model name:\\s*//p'");
    if (!lscpu.empty()) return lscpu;
    return "Linux CPU";
#else
    return "Unknown CPU";
#endif
}

// Busy loop compute kernel per-thread.
// Returns pair<int_ops, float_ops> performed.
static std::pair<unsigned long long, unsigned long long>
compute_kernel(double seconds_target) {
    volatile unsigned long long x = 88172645463393265ull; // LCG seed-ish
    volatile unsigned long long y = 1315423911ull;
    volatile double a = 1.00000011920928955078125; // nearby 1
    volatile double b = 1.0000002384185791015625;
    volatile double c = 0.00000095367431640625;

    const auto start = clk::now();
    unsigned long long iops = 0;
    unsigned long long fops = 0;

    // do fixed-size blocks to reduce time checks
    const int BLOCK = 1 << 15; // ~32k iters between timing checks
    while (true) {
        for (int i = 0; i < BLOCK; ++i) {
            // Integer: 3 ops (mul+add+xor) via LCG-ish + xor
            x = x * 2862933555777941757ULL + 3037000493ULL;
            y ^= x;
            // Float: 2 ops (mul + add)
            a = a * b + c;
            // perturb b,c a bit to avoid degeneracy
            b += 1e-12;
            c += 1e-13;
        }
        iops += 3ull * BLOCK;
        fops += 2ull * BLOCK;
        auto now = clk::now();
        if (std::chrono::duration<double>(now - start).count() >= seconds_target) break;
    }
    return {iops, fops};
}

// Multi-thread runner for compute kernel.
static TestResult run_compute(double seconds_target, unsigned threads, bool single_core) {
    TestResult r;
    r.seconds = seconds_target;

    if (single_core) {
        auto p = compute_kernel(seconds_target);
        r.gops_int = p.first / seconds_target / 1e9;
        r.gflops   = p.second / seconds_target / 1e9;
        return r;
    }

    if (threads == 0) threads = 1;
    std::vector<std::future<std::pair<unsigned long long, unsigned long long>>> futs;
    futs.reserve(threads);
    for (unsigned t = 0; t < threads; ++t) {
        futs.emplace_back(std::async(std::launch::async, [seconds_target]() {
            return compute_kernel(seconds_target);
        }));
    }
    unsigned long long tot_i = 0, tot_f = 0;
    for (auto &f : futs) {
        auto p = f.get();
        tot_i += p.first;
        tot_f += p.second;
    }
    r.gops_int = tot_i / seconds_target / 1e9;
    r.gflops   = tot_f / seconds_target / 1e9;
    return r;
}

// Memory bandwidth test: parallel memcpy on disjoint buffers.
static TestResult run_mem(double seconds_target, unsigned threads) {
    TestResult r;
    r.seconds = seconds_target;
    if (threads == 0) threads = 1;

    const size_t per_thread_bytes = 16ull * 1024 * 1024; // 16MB per thread
    const size_t total_bytes = per_thread_bytes * threads;

    std::vector<std::vector<unsigned char>> src(threads), dst(threads);
    for (unsigned t = 0; t < threads; ++t) {
        src[t].resize(per_thread_bytes, (unsigned char)(t+1));
        dst[t].resize(per_thread_bytes, 0);
    }

    auto worker = [&](unsigned tid) -> unsigned long long {
        const auto start = clk::now();
        unsigned long long bytes_moved = 0;
        while (true) {
            std::memcpy(dst[tid].data(), src[tid].data(), per_thread_bytes);
            bytes_moved += per_thread_bytes;
            auto now = clk::now();
            if (std::chrono::duration<double>(now - start).count() >= seconds_target) break;
        }
        return bytes_moved;
    };

    std::vector<std::future<unsigned long long>> futs;
    futs.reserve(threads);
    for (unsigned t = 0; t < threads; ++t) {
        futs.emplace_back(std::async(std::launch::async, worker, t));
    }
    unsigned long long total_moved = 0;
    for (auto &f : futs) total_moved += f.get();

    // memcpy counts as copy size bytes moved; some folks count R+W=2x, but we keep it 1x for simplicity.
    r.gbps = (total_moved / seconds_target) / 1e9;
    return r;
}

// Simple CLI parsing
struct Args {
    double total_time = 30.0;
    double t_single = -1.0;
    double t_multi  = -1.0;
    double t_mem    = -1.0;
    unsigned threads = std::thread::hardware_concurrency();
    std::string json_path;
    std::string md_path;
};

static Args parse_args(int argc, char** argv) {
    Args a;
    for (int i = 1; i < argc; ++i) {
        std::string s = argv[i];
        auto next = [&](double &val){ if (i+1 < argc) val = std::atof(argv[++i]); };
        auto nextu = [&](unsigned &val){ if (i+1 < argc) val = (unsigned)std::strtoul(argv[++i], nullptr, 10); };
        auto nexts = [&](std::string &val){ if (i+1 < argc) val = argv[++i]; };

        if (s == "--time") next(a.total_time);
        else if (s == "--single") next(a.t_single);
        else if (s == "--multi") next(a.t_multi);
        else if (s == "--mem") next(a.t_mem);
        else if (s == "--threads") nextu(a.threads);
        else if (s == "--json") nexts(a.json_path);
        else if (s == "--md") nexts(a.md_path);
        else if (s == "--help" || s == "-h") {
            std::cout << "cpu_bench options:\n"
                      << "  --time <sec>      total runtime target (default 30)\n"
                      << "  --single <sec>    single-core compute duration override\n"
                      << "  --multi <sec>     multi-core compute duration override\n"
                      << "  --mem <sec>       memory bandwidth duration override\n"
                      << "  --threads <N>     force thread count for multi/memory (default hw threads)\n"
                      << "  --json <file>     write JSON results\n"
                      << "  --md <file>       write Markdown summary\n";
            std::exit(0);
        }
    }
    return a;
}

static std::string now_iso8601() {
    using namespace std::chrono;
    auto now = system_clock::now();
    std::time_t t = system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    localtime_s(&tm, &t);
#else
    localtime_r(&t, &tm);
#endif
    char buf[64];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S%z", &tm);
    return buf;
}

static double geometric_mean3(double a, double b, double c) {
    if (a <= 0 || b <= 0 || c <= 0) return 0.0;
    return std::pow(a*b*c, 1.0/3.0);
}

int main(int argc, char** argv) {
    Args args = parse_args(argc, argv);

    // Allocate durations (single, multi, mem) if not overridden: ~40%/40%/20%
    double t_single = (args.t_single > 0 ? args.t_single : args.total_time * 0.4);
    double t_multi  = (args.t_multi  > 0 ? args.t_multi  : args.total_time * 0.4);
    double t_mem    = (args.t_mem    > 0 ? args.t_mem    : args.total_time * 0.2);

    AllResults R;
    R.timestamp = now_iso8601();
    R.os = detect_os();
    R.arch = detect_arch();
    R.cpu_name = detect_cpu_name();
    R.threads = (args.threads ? args.threads : std::thread::hardware_concurrency());
    if (R.threads == 0) R.threads = 1;

    // Single-core compute (1 thread)
    R.single_core = run_compute(t_single, 1, /*single_core=*/true);
    // Multi-core compute (N threads)
    R.multi_core  = run_compute(t_multi, R.threads, /*single_core=*/false);
    // Memory bandwidth (N threads)
    R.memory_bw   = run_mem(t_mem, R.threads);

    // derive a single mixed score (geometric mean):
    // for compute we mix int+float as their sum (in Gops-equivalent).
    double sc_mix = R.single_core.gops_int + R.single_core.gflops;
    double mc_mix = R.multi_core.gops_int  + R.multi_core.gflops;
    double mem    = R.memory_bw.gbps;
    R.geometric_mean = geometric_mean3(sc_mix, mc_mix, mem);

    // Console output
    std::cout.setf(std::ios::fixed); std::cout << std::setprecision(3);
    std::cout << "CPU Bench @ " << R.timestamp << "\n"
              << "OS: " << R.os << " | Arch: " << R.arch << "\n"
              << "CPU: " << R.cpu_name << "\n"
              << "Threads: " << R.threads << "\n\n"
              << "[Single-core " << t_single << "s]  Int: " << R.single_core.gops_int << " Gops/s,  FP: " << R.single_core.gflops << " GFLOP/s\n"
              << "[Multi-core "  << t_multi  << "s]  Int: " << R.multi_core.gops_int  << " Gops/s,  FP: " << R.multi_core.gflops  << " GFLOP/s\n"
              << "[Memory    "   << t_mem    << "s]  BW:  " << R.memory_bw.gbps       << " GB/s\n\n"
              << "Geometric mean (compute+mem): " << R.geometric_mean << "\n";

    // JSON output
    if (!args.json_path.empty()) {
        std::ofstream jf(args.json_path);
        jf.setf(std::ios::fixed); jf << std::setprecision(6);
        jf << "{\n";
        jf << "  \"timestamp\": \"" << R.timestamp << "\",\n";
        jf << "  \"os\": \"" << R.os << "\",\n";
        jf << "  \"arch\": \"" << R.arch << "\",\n";
        jf << "  \"cpu_name\": \"" << R.cpu_name << "\",\n";
        jf << "  \"threads\": " << R.threads << ",\n";
        jf << "  \"single_core\": {\"seconds\": " << R.single_core.seconds
           << ", \"gops_int\": " << R.single_core.gops_int
           << ", \"gflops\": " << R.single_core.gflops << "},\n";
        jf << "  \"multi_core\": {\"seconds\": " << R.multi_core.seconds
           << ", \"gops_int\": " << R.multi_core.gops_int
           << ", \"gflops\": " << R.multi_core.gflops << "},\n";
        jf << "  \"memory_bw\": {\"seconds\": " << R.memory_bw.seconds
           << ", \"gbps\": " << R.memory_bw.gbps << "},\n";
        jf << "  \"geometric_mean\": " << R.geometric_mean << "\n";
        jf << "}\n";
    }

    // Markdown summary
    if (!args.md_path.empty()) {
        std::ofstream md(args.md_path);
        md.setf(std::ios::fixed); md << std::setprecision(3);
        md << "# CPU Benchmark Results\n\n";
        md << "- **Timestamp:** " << R.timestamp << "\n";
        md << "- **OS:** " << R.os << "   **Arch:** " << R.arch << "\n";
        md << "- **CPU:** " << R.cpu_name << "\n";
        md << "- **Threads:** " << R.threads << "\n\n";
        md << "| Test | Duration (s) | Integer (Gops/s) | FP (GFLOP/s) | Memory (GB/s) |\n";
        md << "|---|---:|---:|---:|---:|\n";
        md << "| Single-core | " << R.single_core.seconds << " | " << R.single_core.gops_int << " | " << R.single_core.gflops << " | - |\n";
        md << "| Multi-core | "  << R.multi_core.seconds  << " | " << R.multi_core.gops_int  << " | " << R.multi_core.gflops  << " | - |\n";
        md << "| Memory BW | "   << R.memory_bw.seconds   << " | - | - | " << R.memory_bw.gbps << " |\n\n";
        md << "**Geometric mean (compute+mem):** " << R.geometric_mean << "\n";
    }

    return 0;
}
