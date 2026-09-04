import type { Metadata } from "next";
import "./globals.css";
import { Sidebar, TopBar } from "@/components/nav";
import { currentRole } from "@/server/actions";
import { getDashboardStats, supervisorHeartbeat } from "@/server/queries";

export const metadata: Metadata = {
  title: "Waypoint · governed path",
  description: "Promote small internal software from local build to managed production runtimes.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await currentRole();
  const stats = getDashboardStats();
  const hb = supervisorHeartbeat();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Sidebar dbPath=".data/waypoint.db" heartbeatSeconds={hb.secondsAgo} pendingReviews={stats.pendingReviews} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar role={role} pendingReviews={stats.pendingReviews} />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
