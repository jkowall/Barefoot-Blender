
const options = [
  { id: "air", name: "Air", o2: 21, he: 0 },
  { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
  { id: "helium", name: "Helium", o2: 0, he: 100 },
  { id: "custom1", name: "Custom 1", o2: 32, he: 0 },
  { id: "custom2", name: "Custom 2", o2: 18, he: 45 },
];

const topGasId = "custom2";
const selectedTopGas = options.find(o => o.id === topGasId);

function benchmark(fn, iterations = 10_000_000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  return end - start;
}

function withFind() {
  const topO2 = options.find(o => o.id === topGasId)?.o2 ?? 0;
  return topO2;
}

function withDirect() {
  const topO2 = selectedTopGas?.o2 ?? 0;
  return topO2;
}

// Warm up
benchmark(withFind, 1_000_000);
benchmark(withDirect, 1_000_000);

const timeFind = benchmark(withFind);
const timeDirect = benchmark(withDirect);

console.log(`Array.find lookup: ${timeFind.toFixed(4)}ms`);
console.log(`Direct access: ${timeDirect.toFixed(4)}ms`);
console.log(`Improvement: ${((timeFind - timeDirect) / timeFind * 100).toFixed(2)}%`);
