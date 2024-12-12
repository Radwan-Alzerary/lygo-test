const FinancialAccount = require("../model/financialAccount");
const MoneyTransfers = require("../model/moneyTransfers");

const transfer = async (type, fromId, toId, amount) => {
  try {
    // Find the financial accounts of both parties
    console.log("x")

    const fromAccount = await FinancialAccount.findById(fromId);
    const toAccount = await FinancialAccount.findById(toId);
    console.log(toAccount,fromAccount)

    if (!fromAccount || !toAccount) {
      throw new Error("Financial accounts not found");
    }

    
    // Create the money transfer
    const moneyTransfer = new MoneyTransfers({
      transferType: type,
      from: { id: fromId, role: getRole(type, "from") },
      to: { id: toId, role: getRole(type, "to") },
      vault: amount,
    });


    await moneyTransfer.save();

    // Update vault amounts
    fromAccount.vault -= amount;
    toAccount.vault += amount;

    // Add the transaction to both accounts
    const transaction = {
      moneyTransfers: [moneyTransfer._id],
      description: `Transfer ${type} from ${fromId} to ${toId}`,
    };

    fromAccount.transactions.push(transaction);
    toAccount.transactions.push(transaction);

    // Save the updated financial accounts
    await fromAccount.save();
    await toAccount.save();

    console.log(`Transfer successful: ${amount} from ${fromId} to ${toId}`);
  } catch (error) {
    console.error("Error processing transfer:", error);
  }
};

const getRole = (type, direction) => {
  const roleMap = {
    utd: { from: "Users", to: "Driver" },
    utc: { from: "Users", to: "Customer" },
    ctc: { from: "Customer", to: "Customer" },
    ctu: { from: "Customer", to: "Users" },
    ctd: { from: "Customer", to: "Driver" },
    dtu: { from: "Driver", to: "Users" },
    dtc: { from: "Driver", to: "Customer" },
  };
  return roleMap[type][direction];
};

module.exports = transfer;
