import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { TXLINE } from "@/lib/txline/config";

const ALLOWED_PROGRAMS = new Set([
  TXLINE.programId,
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  "11111111111111111111111111111111",
]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { transaction?: string; publicKey?: string };
    if (!body.transaction || !body.publicKey) {
      return Response.json({ error: "Signed transaction and publicKey are required." }, { status: 400 });
    }
    const transaction = Transaction.from(Buffer.from(body.transaction, "base64"));
    const expectedUser = new PublicKey(body.publicKey);
    if (!transaction.feePayer?.equals(expectedUser)) {
      return Response.json({ error: "Transaction fee payer does not match the connected wallet." }, { status: 400 });
    }
    if (!transaction.signatures.some((entry) => entry.publicKey.equals(expectedUser) && entry.signature)) {
      return Response.json({ error: "The wallet has not signed the transaction." }, { status: 400 });
    }
    const programs = transaction.instructions.map((instruction) => instruction.programId.toBase58());
    if (!programs.includes(TXLINE.programId) || programs.some((program) => !ALLOWED_PROGRAMS.has(program))) {
      return Response.json({ error: "The transaction contains an unexpected program." }, { status: 400 });
    }

    const connection = new Connection(TXLINE.rpc, "confirmed");
    const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      return Response.json({ error: "The devnet subscription transaction failed.", detail: confirmation.value.err }, { status: 400 });
    }
    return Response.json({ signature, network: "devnet", confirmed: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not submit the devnet transaction." }, { status: 400 });
  }
}

