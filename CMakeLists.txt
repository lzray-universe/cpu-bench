cmake_minimum_required(VERSION 3.16)
project(cpu_bench LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(cpu_bench bench/bench.cpp)

if(MSVC)
  target_compile_options(cpu_bench PRIVATE /O2 /EHsc)
  # Prefer AVX2 on x64 if available; skip on ARM64.
  if(NOT CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|arm64|ARM|arm")
    target_compile_options(cpu_bench PRIVATE /arch:AVX2)
  endif()
else()
  target_compile_options(cpu_bench PRIVATE -O3 -ffast-math -march=native)
endif()

find_package(Threads REQUIRED)
target_link_libraries(cpu_bench PRIVATE Threads::Threads)
