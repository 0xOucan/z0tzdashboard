import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata = {
  title: "Z0tz Dashboard",
  description: "Internal admin dashboard for Z0tz relayer + paymaster operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 px-8 py-7 overflow-x-hidden">{children}</main>
        </div>
      </body>
    </html>
  );
}
