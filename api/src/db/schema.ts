import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const addresses = sqliteTable('addresses', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  localPart: text('local_part').notNull(),
  domain: text('domain').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  addressId: text('address_id')
    .notNull()
    .references(() => addresses.id, { onDelete: 'cascade' }),
  messageIdHdr: text('message_id_hdr'),
  fromRaw: text('from_raw').notNull().default(''),
  fromAddress: text('from_address').notNull().default(''),
  subject: text('subject').notNull().default('(no subject)'),
  textBody: text('text_body').notNull().default(''),
  htmlBody: text('html_body').notNull().default(''),
  rawBody: text('raw_body').notNull().default(''),
  headersJson: text('headers_json').notNull().default('{}'),
  size: integer('size').notNull().default(0),
  hasAttachments: integer('has_attachments').notNull().default(0),
  attachmentMeta: text('attachment_meta').notNull().default('[]'),
  receivedAt: integer('received_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
