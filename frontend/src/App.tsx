import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api/queryClient";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { QuizListPage } from "./pages/QuizListPage";
import { QuizFormPage } from "./pages/QuizFormPage";
import { HostLobbyPage } from "./pages/HostLobbyPage";
import { HostGamePage } from "./pages/HostGamePage";
import { SessionHistoryPage } from "./pages/SessionHistoryPage";
import { AnalyticsDashboardPage } from "./pages/AnalyticsDashboardPage";
import { PlatformDashboardPage } from "./pages/PlatformDashboardPage";
import { JoinPage } from "./pages/JoinPage";
import { PlayerLobbyPage } from "./pages/PlayerLobbyPage";
import { PlayerGamePage } from "./pages/PlayerGamePage";
import { LandingPage } from "./pages/LandingPage";
import { useAuthStore } from "./stores/authStore";

const NotFound = () => (
  <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center" style={{ background: "#1a0a2e" }}>
    <div className="ramadan-pattern" />
    <div className="relative z-10 text-center text-white">
      <h1 className="text-6xl font-black" style={{ color: "#f5c842" }}>404</h1>
      <p className="mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>Page not found</p>
    </div>
  </div>
);

// Authenticated users skip the landing page and go straight to the dashboard.
function RootRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  return isAuthenticated ? <Navigate to="/admin" replace /> : <LandingPage />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Landing page */}
          <Route path="/" element={<RootRoute />} />

          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Protected admin routes — dashboard shell */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          >
            <Route index element={<QuizListPage />} />
            <Route path="quizzes" element={<QuizListPage />} />
            <Route path="quizzes/new" element={<QuizFormPage />} />
            <Route path="quizzes/:quizID/edit" element={<QuizFormPage />} />
            <Route path="history" element={<SessionHistoryPage />} />
            <Route path="analytics" element={<AnalyticsDashboardPage />} />
            <Route path="platform" element={<PlatformDashboardPage />} />
          </Route>

          {/* Full-screen admin game routes — outside dashboard shell to avoid double layout */}
          <Route path="/admin/host/:code" element={<ProtectedRoute><HostLobbyPage /></ProtectedRoute>} />
          <Route path="/admin/game/:code" element={<ProtectedRoute><HostGamePage /></ProtectedRoute>} />

          {/* Player-facing public routes */}
          <Route path="/join" element={<JoinPage />} />
          <Route path="/game/:code" element={<PlayerLobbyPage />} />
          <Route path="/game/:code/play" element={<PlayerGamePage />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
