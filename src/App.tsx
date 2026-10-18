import { HashRouter, Route, Routes } from 'react-router-dom'
import { FeedbackProvider } from './components/feedback'
import { Layout } from './components/Layout'
import { Catalog } from './pages/Catalog'
import { CustomerDetail } from './pages/CustomerDetail'
import { Customers } from './pages/Customers'
import { Dashboard } from './pages/Dashboard'
import { DocumentPage } from './pages/DocumentPage'
import { Documents } from './pages/Documents'
import { Dunning } from './pages/Dunning'
import { Expenses } from './pages/Expenses'
import { NotFound } from './pages/NotFound'
import { Onboarding } from './pages/Onboarding'
import { Reports } from './pages/Reports'
import { SettingsPage } from './pages/Settings'
import { TimeTracking } from './pages/TimeTracking'

export default function App() {
  return (
    <FeedbackProvider>
      <HashRouter>
        <Routes>
          <Route path="/willkommen" element={<Onboarding />} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="rechnungen" element={<Documents />} />
            <Route path="rechnungen/:id" element={<DocumentPage />} />
            <Route path="mahnwesen" element={<Dunning />} />
            <Route path="leistungen" element={<Catalog />} />
            <Route path="ausgaben" element={<Expenses />} />
            <Route path="kunden" element={<Customers />} />
            <Route path="kunden/:id" element={<CustomerDetail />} />
            <Route path="zeit" element={<TimeTracking />} />
            <Route path="berichte" element={<Reports />} />
            <Route path="einstellungen" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </FeedbackProvider>
  )
}
