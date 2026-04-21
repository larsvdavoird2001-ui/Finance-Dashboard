import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

export const CHART_COLORS = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  grid:        'rgba(255,255,255,0.06)',
  tick:        '#3f4d63',
}

export const baseChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: '#7c8aa0', font: { family: 'Inter, sans-serif', size: 11 }, boxWidth: 10 },
    },
    tooltip: {
      backgroundColor: '#10141f',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      titleColor: '#dde3f0',
      bodyColor: '#7c8aa0',
      titleFont: { family: 'Inter, sans-serif', size: 12 },
      bodyFont: { family: 'JetBrains Mono, monospace', size: 11 },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#3f4d63', font: { family: 'Inter, sans-serif', size: 10 } },
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#3f4d63', font: { family: 'Inter, sans-serif', size: 10 } },
    },
  },
} as const
