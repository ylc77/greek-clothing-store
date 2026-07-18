# v1 维护者密钥与轮换检查清单

本清单只记录状态和日期，绝不记录秘密值。

## 每客户清单

- [ ] Supabase publishable/anon key 用途已记录；公开表 RLS/grants 已复核。
- [ ] Supabase service/secret key 仅在维护者安全环境和 Vercel 服务端。
- [ ] Vercel、GitHub、日志、文档、截图、聊天和浏览器 bundle secret scan 通过。
- [ ] `AUTH_RATE_LIMIT_SECRET` 每客户唯一；轮换后创建新 deployment。
- [ ] Developer password 每客户唯一，保存在密码管理器；`developer:status` 显示 initialized 且无需轮换。
- [ ] Developer rotate 后旧密码和全部旧 Cookie 失效。
- [ ] 可选 AI key 为客户专用低额度 key，预算和告警已设置。
- [ ] 可选应急角色密码满足策略、互不重复，并验证限流；不需要时保持未配置。
- [ ] Preview 临时 service/secret key 和分支环境变量在验收后删除；旧 deployment 被删除/限制或对应 key 已失效。
- [ ] 客户移交、维护者离职、疑似泄漏、权限变更或定期复核时完成轮换。

## 轮换记录字段

```text
客户代号：
Supabase project ref：
Vercel project ID：
轮换类型：developer / service-secret / auth-limit / AI / emergency
轮换日期：
执行人：
新 deployment ID：
旧凭据失效验证：PASS / FAIL
健康检查与回归：PASS / FAIL
备注（不得包含秘密）：
```

## 恢复原则

- Developer 密码丢失：使用该客户 service role 的可信 CLI 执行 `developer:rotate`，不新增公开重置接口。
- Service/secret key 疑似泄漏：先撤销/轮换，再更新服务端环境并重新部署，最后检查日志和未授权访问。
- 不通过邮件发送开发者密码；不把 service role 交给普通商家 owner；不从其他客户复制凭据。
