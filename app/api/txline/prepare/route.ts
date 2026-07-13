import { PublicKey, Connection, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TXLINE } from "@/lib/txline/config";

export async function POST(request: Request) {
  try {
    const { publicKey } = await request.json() as { publicKey?: string };
    if (!publicKey) return Response.json({ error: "publicKey is required" }, { status: 400 });

    const user = new PublicKey(publicKey);
    const programId = new PublicKey(TXLINE.programId);
    const tokenMint = new PublicKey(TXLINE.tokenMint);
    const connection = new Connection(TXLINE.rpc, "confirmed");
    const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, user, false, TOKEN_2022_PROGRAM_ID);
    const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], programId);
    const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], programId);
    const treasuryVault = getAssociatedTokenAddressSync(tokenMint, treasuryPda, true, TOKEN_2022_PROGRAM_ID);

    const transaction = new Transaction();
    if (!(await connection.getAccountInfo(userTokenAccount))) {
      transaction.add(createAssociatedTokenAccountInstruction(
        user, userTokenAccount, user, tokenMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
    }

    const data = Buffer.from([254, 28, 191, 138, 156, 179, 183, 53, 1, 0, 4]);
    transaction.add(new TransactionInstruction({
      programId,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: pricingMatrix, isSigner: false, isWritable: false },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: treasuryVault, isSigner: false, isWritable: true },
        { pubkey: treasuryPda, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    }));
    const latest = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = user;
    transaction.recentBlockhash = latest.blockhash;
    return Response.json({
      transaction: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      network: "devnet",
      serviceLevelId: TXLINE.serviceLevelId,
      durationWeeks: TXLINE.durationWeeks,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not prepare subscription" }, { status: 400 });
  }
}

