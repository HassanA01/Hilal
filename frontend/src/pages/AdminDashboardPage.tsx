import { useState } from "react";
import { Outlet, useNavigate, NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { CrescentIcon, LanternIcon } from "../components/icons";
import { WhatsNewModal } from "../components/WhatsNewModal";
import { useAuthStore } from "../stores/authStore";

function NavItem({
  to,
  label,
  onClick,
}: {
  to: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
          isActive ? "font-bold" : "opacity-70 hover:opacity-100"
        }`
      }
      style={({ isActive }) =>
        isActive
          ? { background: "#f5c842", color: "#1a0a2e" }
          : { color: "#f5c842" }
      }
    >
      {label}
    </NavLink>
  );
}

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const { admin, clearAuth } = useAuthStore();
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function handleLogout() {
    clearAuth();
    navigate("/login", { replace: true });
  }

  const navLinks = [
    { to: "/admin/quizzes", label: "Quizzes" },
    { to: "/admin/history", label: "History" },
    { to: "/admin/analytics", label: "Analytics" },
    ...(isSuperadmin ? [{ to: "/admin/platform", label: "Platform" }] : []),
  ];

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: "#1a0a2e" }}>
      <div className="ramadan-pattern" />

      {/* Header */}
      <header
        className="relative z-20"
        style={{
          background:
            "linear-gradient(180deg, rgba(30, 15, 50, 0.95) 0%, rgba(20, 10, 40, 0.9) 100%)",
          borderBottom: "1px solid rgba(245, 200, 66, 0.2)",
        }}
      >
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 max-w-full overflow-hidden">
          {/* Logo + Nav (left-aligned, same as original) */}
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            <motion.div
              className="flex items-center gap-2 shrink-0"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="relative">
                <CrescentIcon className="w-8 h-8" style={{ color: "#f5c842" }} />
                <LanternIcon
                  className="w-4 h-4 absolute -bottom-1 -right-1"
                  style={{ color: "#f5c842" }}
                />
              </div>
              <span className="text-xl font-black" style={{ color: "#f5c842" }}>
                Hilal
              </span>
            </motion.div>

            {/* Desktop nav — hidden on mobile */}
            <nav className="hidden md:flex items-center gap-0.5 sm:gap-1">
              {navLinks.map((link) => (
                <NavItem key={link.to} to={link.to} label={link.label} />
              ))}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {admin?.email && (
              <span
                className="hidden xl:block text-sm truncate max-w-[140px]"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                {admin.email}
              </span>
            )}
            <motion.button
              onClick={handleLogout}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="hidden md:block text-sm font-medium px-3 py-2 rounded-lg transition shrink-0"
              style={{
                color: "rgba(255,255,255,0.6)",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
            >
              Sign out
            </motion.button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden flex flex-col gap-1 p-2"
              aria-label="Toggle menu"
            >
              <span
                className="block w-5 h-0.5 rounded"
                style={{ background: "#f5c842" }}
              />
              <span
                className="block w-5 h-0.5 rounded"
                style={{ background: "#f5c842" }}
              />
              <span
                className="block w-5 h-0.5 rounded"
                style={{ background: "#f5c842" }}
              />
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden overflow-hidden"
              style={{ borderTop: "1px solid rgba(245, 200, 66, 0.1)" }}
            >
              <div className="px-4 py-3 flex flex-col gap-1">
                {navLinks.map((link) => (
                  <NavItem
                    key={link.to}
                    to={link.to}
                    label={link.label}
                    onClick={() => setMobileMenuOpen(false)}
                  />
                ))}
                {admin?.email && (
                  <span
                    className="px-3 py-2 text-sm truncate"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    {admin.email}
                  </span>
                )}
                <button
                  onClick={handleLogout}
                  className="text-left px-3 py-2 rounded-lg text-sm font-medium transition"
                  style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  Sign out
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Outlet />
      </main>

      <WhatsNewModal />
    </div>
  );
}
