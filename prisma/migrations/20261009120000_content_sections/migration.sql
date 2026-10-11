-- Content sections become a table the owner can edit; the eight built-in topics keep their codes as ids.
CREATE TABLE "ContentSection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentSection_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ContentSection" ("id", "name", "description", "sortOrder") VALUES
  ('PRICES', 'Цены', 'Новые или изменённые цены, прайс-листы, RSP/DSP.', 0),
  ('NEW_PRODUCTS', 'Новинки', 'Запуски, новые SKU, форматы и вкусы.', 1),
  ('PROMO', 'Акции и механики', 'Торговые акции и механики (например 10+1), бонусы, скидки, подарки за покупку.', 2),
  ('TRAINING', 'Обучение', 'Инструкции, обучающие ролики, знание продукта, как правильно.', 3),
  ('RESEARCH', 'Опросы и исследования', 'Опросы, анкеты, просьбы дать обратную связь или данные.', 4),
  ('MOTIVATION', 'Мотивация и конкурсы', 'Конкурсы, рейтинги, призы и мотивация команды или партнёров.', 5),
  ('COMPANY_NEWS', 'Новости компании', 'Поздравления, праздники, новости и объявления компании.', 6),
  ('SERVICE', 'Сервис и поддержка', 'Поддержка, заказы, доставка, как связаться, изменения в сервисе.', 7);

ALTER TABLE "ContentPost" ALTER COLUMN "topic" TYPE TEXT USING "topic"::TEXT;
DROP TYPE "ContentTopic";

ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_topic_fkey" FOREIGN KEY ("topic") REFERENCES "ContentSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
