"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Search } from "lucide-react";

interface Person {
  id: number;
  name: string;
  role: string;
  status: string;
  phone: string;
  bank: string;
  bank_number: string;
  tier: string;
  aliases: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  "가이드": "bg-blue-100 text-blue-700",
  "기사": "bg-green-100 text-green-700",
  "보조": "bg-purple-100 text-purple-700",
};

const STATUS_COLORS: Record<string, string> = {
  "활동 중": "bg-green-100 text-green-700",
  "일시중단": "bg-yellow-100 text-yellow-700",
  "계약종료": "bg-gray-100 text-gray-500",
};

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [stats, setStats] = useState<{ role: string; cnt: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    fetch("/api/people")
      .then((r) => r.json())
      .then((d) => {
        setPeople(d.people || []);
        setStats(d.stats || []);
        setLoading(false);
      });
  }, []);

  const filtered = people.filter((p) => {
    if (keyword && !p.name.toLowerCase().includes(keyword.toLowerCase())) return false;
    if (roleFilter && p.role !== roleFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">인력 관리</h1>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-gray-500">전체 인력</div>
            <div className="text-2xl font-bold">{people.length}명</div>
          </CardContent>
        </Card>
        {stats.map((s) => (
          <Card key={s.role}>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-gray-500">활동 중 {s.role}</div>
              <div className="text-2xl font-bold">{s.cnt}명</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 필터 */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <Input
                className="pl-7 h-8 text-xs"
                placeholder="이름 검색..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="flex gap-1">
              {["", "가이드", "기사", "보조"].map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    roleFilter === r
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {r || "전체"}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {["", "활동 중", "일시중단", "계약종료"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    statusFilter === s
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {s || "전체"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-400">{filtered.length}명 표시</div>
        </CardContent>
      </Card>

      {/* 테이블 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>등급</TableHead>
                <TableHead>전화번호</TableHead>
                <TableHead>은행</TableHead>
                <TableHead>계좌번호</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-400">로딩 중...</TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${ROLE_COLORS[p.role] || ""}`}>{p.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${STATUS_COLORS[p.status] || ""}`}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">{p.tier || "-"}</TableCell>
                    <TableCell className="text-xs text-gray-500">{p.phone || "-"}</TableCell>
                    <TableCell className="text-xs text-gray-500">{p.bank || "-"}</TableCell>
                    <TableCell className="text-xs text-gray-500 font-mono">{p.bank_number || "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
