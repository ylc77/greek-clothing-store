# v1 备份与恢复手册

CSV 导出不是灾备。正式备份必须覆盖数据库角色/schema、应用与 Auth data、migration history、Storage 对象和 SHA-256 manifest。

## 备份

仅在维护者电脑的受保护目录执行：

```powershell
npm run customer:backup -- --project-ref 客户项目ref --output D:\encrypted-backups\客户代号\日期时间
npm run customer:backup:verify -- --backup D:\encrypted-backups\客户代号\日期时间
```

执行前确认：

- 当前仓库 link 的 project ref 与参数完全相同；
- `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、数据库 URL/密码只在本机安全环境中；
- 备份目录不在 Git、云盘公开目录或聊天附件中；
- 可用空间足够，manifest 中全部 SHA-256 校验通过。

## 恢复

只恢复到已确认为空的隔离 Supabase：

```powershell
npm run customer:restore -- --project-ref 目标测试项目ref --backup D:\encrypted-backups\客户代号\日期时间
```

工具会再次要求输入 `RESTORE 目标项目ref`。若目标已有应用表、Auth 用户、migration history 或 Storage 对象，应在写入前拒绝。

## 恢复验收

- migration history 数量和版本完全一致；
- 商品、Variant、余额、订单、明细、付款、库存流水、设置、法律版本和员工数量一致；
- Storage 清单、路径、大小和字节 SHA-256 一致；
- RLS、grant、RPC execute 和 service-role-only 表保持安全；
- runtime health 全部 ready；
- reconciliation 为 0；
- 测试项目最终清理或按维护计划保留。

## RPO / RTO

- 当前工具提供人工时间点备份，RPO 等于最近一次成功且校验通过的备份时间；没有自动连续增量保证。
- 建议营业中的客户每日备份，重大升级、批量导入和库存盘点前额外备份。
- v1 本地数据库 + Storage 完整恢复演练低于 90 秒，目标 RTO 为 4 小时；真实客户数据量、网络和 Supabase 区域会影响结果。

## 安全

- manifest 不保存 service key、数据库密码或开发者明文密码。
- 恢复命令通过标准输入传递数据库密码，不把密码写入命令参数或临时 SQL 文件。
- 备份访问应最小化，定期验证可读性并按客户合同轮换/删除。
