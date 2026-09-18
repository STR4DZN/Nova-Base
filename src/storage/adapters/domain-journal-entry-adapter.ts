import { err, ok, type Result } from "../../core/contracts/result.js";
import { createPublicError } from "../../core/contracts/public-error.js";
import type { DomainRecord } from "../../domains/domain-schema.js";
import {
  decodeDomainRecord,
  DOMAIN_FLAG_NAMESPACE,
  encodeDomainRecord
} from "../codecs/domain-codec.js";

export interface JournalEntryDocumentLike {
  readonly name: string;
  readonly flags?: Readonly<Record<string, unknown>>;
  readonly ownership?: Readonly<Record<string, number | string>>;
  update(data: Record<string, unknown>): Promise<void>;
}

export class DomainJournalEntryAdapter {
  constructor(private readonly document: JournalEntryDocumentLike) {}

  read(): Result<{
    readonly name: string;
    readonly record: DomainRecord;
    readonly ownership?: Readonly<Record<string, number | string>>;
  }> {
    const payload = this.document.flags?.[DOMAIN_FLAG_NAMESPACE];
    const decoded = decodeDomainRecord(payload);
    if (!decoded.ok) return decoded;
    return ok({
      name: this.document.name,
      record: decoded.value,
      ...(this.document.ownership !== undefined ? { ownership: this.document.ownership } : {})
    });
  }

  async write(name: string, record: DomainRecord): Promise<Result<void>> {
    if (name.trim().length === 0) {
      return err(createPublicError({
        code: "DM_INVALID_DOMAIN_NAME",
        category: "validation",
        message: "Domain name cannot be empty"
      }));
    }

    await this.document.update({
      name,
      [`flags.${DOMAIN_FLAG_NAMESPACE}`]: encodeDomainRecord(record)
    });
    return ok(undefined);
  }
}
