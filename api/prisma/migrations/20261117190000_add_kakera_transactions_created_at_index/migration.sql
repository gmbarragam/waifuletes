-- Índice por data no extrato de Zinthos para a rota interna de resumo da economia
-- (GET /internal/economy/summary), que filtra janelas de tempo sem userId.
-- CREATE INDEX (não CONCURRENTLY, como as demais migrações): segura um lock SHARE em
-- kakera_transactions durante a construção — leituras seguem, escritas no extrato esperam.
CREATE INDEX IF NOT EXISTS "kakera_transactions_createdAt_idx" ON "kakera_transactions"("createdAt");
