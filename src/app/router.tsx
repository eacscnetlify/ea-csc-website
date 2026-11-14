import PublicBulletinsPage from '../features/bulletins/PublicBulletinsPage'
import BulletinBuilderPage from '../features/bulletins/BulletinBuilderPage'
import ReleasePanel from '../features/publication/ReleasePanel'
import ReviewQueuePage from '../features/reviews/ReviewQueuePage'
import { BrowserRouter, Route, Routes } from 'react-router'
import LoginPage from '../features/auth/LoginPage'
import RequireAuth from '../features/auth/RequireAuth'
import ResetPasswordPage from '../features/auth/ResetPasswordPage'
import UpdatePasswordPage from '../features/auth/UpdatePasswordPage'
import ConnectionCheckPage from '../features/development/ConnectionCheckPage'
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
          <Route path="bulletins" element={<PublicBulletinsPage />} />
          <Route path="login" element={<LoginPage />} />

          <Route path="auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="auth/update-password" element={<UpdatePasswordPage />} />

          <Route
            path="officer"
            element={
              <RequireAuth>
                <OfficerWorkspacePage />
              </RequireAuth>
            }
          />
          <Route
            path="officer/reviews"
            element={
              <RequireAuth>
                <ReviewQueuePage />
              </RequireAuth>
            }
          />
          <Route
            path="officer/releases"
            element={
              <RequireAuth>
                <ReleasePanel />
              </RequireAuth>
            }
          />
          <Route
            path="officer/bulletins"
            element={
              <RequireAuth>
                <BulletinBuilderPage />
              </RequireAuth>
            }
          />
          {import.meta.env.DEV && (
            <Route path="dev/connection" element={<ConnectionCheckPage />} />
          )}

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
