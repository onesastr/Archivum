import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('root element missing')

createRoot(container).render(
  <StrictMode>
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <App />
    </TooltipProvider>
  </StrictMode>
)
