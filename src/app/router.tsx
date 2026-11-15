import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import RequireAuth from '../features/auth/RequireAuth'
import AppLayout from './AppLayout'

const TurnoverPage = lazy(() => import('../features/turnover/TurnoverPage'))
const AccessPage = lazy(() => import('../features/admin/AccessPage'))
const PublicBulletinsPage = lazy(
  () => import('../features/bulletins/PublicBulletinsPage'),
)
const BulletinBuilderPage = lazy(
  () => import('../features/bulletins/BulletinBuilderPage'),
)
const ReleasePanel = lazy(() => import('../features/publication/ReleasePanel'))
const ReviewQueuePage = lazy(
  () => import('../features/reviews/ReviewQueuePage'),
)
const LoginPage = lazy(() => import('../features/auth/LoginPage'))
const SignUpPage = lazy(() => import('../features/auth/SignUpPage'))
const AccountPage = lazy(() => import('../features/auth/AccountPage'))
const CouncilHistoryPage = lazy(
  () => import('../features/history/CouncilHistoryPage'),
)
const ResetPasswordPage = lazy(
  () => import('../features/auth/ResetPasswordPage'),
)
const UpdatePasswordPage = lazy(
  () => import('../features/auth/UpdatePasswordPage'),
)
const ConnectionCheckPage = lazy(
  () => import('../features/development/ConnectionCheckPage'),
)
const PublicLibraryPage = lazy(
  () => import('../features/records/PublicLibraryPage'),
)
const RecordDetailPage = lazy(
  () => import('../features/records/RecordDetailPage'),
)
const HelpPage = lazy(() => import('../features/help/HelpPage'))
const OfficerWorkspacePage = lazy(
  () => import('../features/workspace/OfficerWorkspacePage'),
)
const NotFoundPage = lazy(() => import('./NotFoundPage'))

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm"
    >
      Loading page…
    </div>
  )
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<PublicLibraryPage />} />
            <Route path="records/:recordId" element={<RecordDetailPage />} />
            <Route path="bulletins" element={<PublicBulletinsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="signup" element={<SignUpPage />} />
            <Route path="account" element={<AccountPage />} />

            <Route path="auth/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="auth/update-password"
              element={<UpdatePasswordPage />}
            />

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
            <Route
              path="officer/history"
              element={
                <RequireAuth>
                  <CouncilHistoryPage />
                </RequireAuth>
              }
            />
            <Route
              path="officer/turnover"
              element={
                <RequireAuth>
                  <TurnoverPage />
                </RequireAuth>
              }
            />
            <Route
              path="officer/admin/access"
              element={
                <RequireAuth>
                  <AccessPage />
                </RequireAuth>
              }
            />
            {import.meta.env.DEV && (
              <Route path="dev/connection" element={<ConnectionCheckPage />} />
            )}

            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
