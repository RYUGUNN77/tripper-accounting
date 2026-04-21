"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  Upload,
  DollarSign,
  Users,
  FileBarChart,
  Settings,
  Calculator,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Link2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/transactions", label: "거래내역", icon: ArrowLeftRight },
  { href: "/classify", label: "분류", icon: Tags },
  { href: "/data", label: "데이터 관리", icon: Upload },
  { href: "/data/connections", label: "연결기관", icon: Link2 },
  { href: "/settlement", label: "투어 정산", icon: Calculator },
  { href: "/forecast", label: "재무 예측", icon: TrendingUp },
  { href: "/forex", label: "외화 계좌", icon: DollarSign },
  { href: "/people", label: "인력 관리", icon: Users },
  { href: "/reports", label: "리포트", icon: FileBarChart },
  { href: "/settings", label: "설정", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-white transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* 로고 */}
      <div className="flex items-center justify-between px-4 h-14 border-b">
        {!collapsed && (
          <span className="font-bold text-sm text-gray-900">
            트립퍼 회계
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-gray-100 text-gray-500"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : item.href === "/data"
                ? pathname === "/data"
                : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2 mx-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon size={18} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* 하단 */}
      {!collapsed && (
        <div className="px-4 py-3 border-t text-xs text-gray-400">
          TRIPPER KOREA
        </div>
      )}
    </aside>
  );
}
