import { BrowserRouter, Route, Routes } from 'react-router'
import LoginPage from '../features/auth/LoginPage'
import PublicLibraryPage from '../features/records/PublicLibraryPage'
import RecordDetailPage from '../features/records/RecordDetailPage'
import OfficerWorkspacePage from '../features/workspace/OfficerWorkspacePage'
import AppLayout from './AppLayout'
import NotFoundPage from './NotFoundPage'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<PublicLibraryPage />} />
          <Route path="records/:recordId" element={<RecordDetailPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="officer" element={<OfficerWorkspacePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
