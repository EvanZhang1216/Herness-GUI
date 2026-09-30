import { useNavigate } from 'react-router'

import { SETTINGS_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'

export function ModelSettingsLinks() {
  const navigate = useNavigate()

  return (
    <div className="grid gap-2">
      <h2 className="text-base font-semibold">模型设置</h2>
      <p className="text-xs text-muted-foreground">下方选择主模型和子模型；自定义服务地址与密钥可直接从这里管理。</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate(`${SETTINGS_ROUTE}?tab=providers&pview=custom-endpoints`)} size="sm" variant="secondary">
          自定义 API · 地址 / 模型 / Key
        </Button>
        <Button onClick={() => navigate(`${SETTINGS_ROUTE}?tab=providers&pview=keys`)} size="sm" variant="secondary">
          API 密钥
        </Button>
      </div>
    </div>
  )
}
