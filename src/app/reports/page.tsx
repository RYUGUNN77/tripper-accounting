"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileBarChart, Download } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">리포트</h1>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">월별 재무 리포트</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            선택한 월의 재무 현황 리포트를 엑셀 파일로 다운로드합니다.
            요약, 카테고리별 분석, 거래내역, 차트가 포함됩니다.
          </p>
          <div className="flex items-center gap-4">
            <Button variant="outline" className="gap-2" disabled>
              <Download size={16} />
              리포트 다운로드 (구현 예정)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
