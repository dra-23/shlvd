// Chart.js is only needed on Profile and the BotM month page, so it's loaded
// on first use instead of being part of the startup bundle.
let chartPromise = null

export function loadChart() {
  chartPromise ??= import('chart.js').then(({ Chart, registerables }) => {
    Chart.register(...registerables)
    Chart.defaults.font.family = 'Nunito, system-ui, sans-serif'
    Chart.defaults.font.size   = 12
    return Chart
  })
  return chartPromise
}
