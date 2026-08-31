const fixtureMarkerPlugin = { name: 'fixture-marker-plugin' }

export default {
  plugins: [fixtureMarkerPlugin],
  define: { __FIXTURE__: JSON.stringify('kept') },
  server: { allowedHosts: ['existing.example.internal'] },
}
