// Tests run as an English device, whatever language the machine itself is set to.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', language: 'en-GB', languages: ['en-GB'] },
  configurable: true,
  writable: true,
});

// No stored language choice: Node's own localStorage needs a file and warns without one.
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
