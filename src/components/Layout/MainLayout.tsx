
import Sidebar from "./Sidebar";
import Header from "./Header";
import { Outlet } from "react-router-dom";

interface MainLayoutProps {
  children?: React.ReactNode;
  title?: string;
}

const MainLayout = ({ title }: MainLayoutProps) => {
  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr]">
      <Sidebar />
      <div className="flex flex-col min-h-screen">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
