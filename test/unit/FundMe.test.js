const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("FundMe", function () {
          let fundMe
          let mockV3Aggregator
          let deployer
          const sendValue = ethers.utils.parseEther("1")
          beforeEach(async () => {
              // const accounts = await ethers.getSigners()
              // deployer = accounts[0]
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              fundMe = await ethers.getContract("FundMe", deployer)
              mockV3Aggregator = await ethers.getContract(
                  "MockV3Aggregator",
                  deployer
              )
              priceConverter = await ethers.getContractFactory(
                "PriceConverter"
                ,deployer
              )
          })

          describe("constructor", function () {
              it("sets the aggregator addresses correctly", async () => {
                  const response = await fundMe.getPriceFeed()
                  assert.equal(response, mockV3Aggregator.address)
              })
          })

          describe("fund", function () {
              // https://ethereum-waffle.readthedocs.io/en/latest/matchers.html
              // could also do assert.fail
              it("Fails if you don't send enough ETH", async () => {
                  await expect(fundMe.fund()).to.be.revertedWith(
                      "You need to spend more ETH!"
                  )
              })
              //optional check
              it("Fails if you send just 2 wei less than the MINIMUM_USD", async () => {
                const {answer} = await mockV3Aggregator.latestRoundData() 
                const ethPrice = answer * 10000000000
                const minUSD = await fundMe.MINIMUM_USD()
                const just2Wei = ethers.utils.formatEther("2")
                const sendValueLess = ethers.utils.parseEther(((minUSD / ethPrice - just2Wei)).toString())
                await expect(fundMe.fund({ value: sendValueLess})).to.be.revertedWith(
                    "You need to spend more ETH!")
              })
              // we could be even more precise here by making sure exactly $50 works
              // but this is good enough for now
              it("Updates the amount funded data structure", async () => {
                  await fundMe.fund({ value: sendValue })
                  const response = await fundMe.getAddressToAmountFunded(
                      deployer
                  )
                  console.log(response.toString())
                  assert.equal(response.toString(), sendValue.toString())
              })
              it("Adds funder to array of funders", async () => {
                  await fundMe.fund({ value: sendValue })
                  const response = await fundMe.getFunder(0)
                  assert.equal(response, deployer)
              })
          })
          describe("withdraw with no balance", function () {
            it("withdraw failes when there is no balance in the contract", async () => {
                await expect(fundMe.withdraw()).to.be.reverted
            })
          })

          describe("withdraw", function () {
              beforeEach(async () => {
                  await fundMe.fund({ value: sendValue })
              })
              it("withdraws ETH from a single funder", async () => {
                  // Arrange
                  const startingFundMeBalance =
                      await fundMe.provider.getBalance(fundMe.address)
                  const startingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Act
                  const transactionResponse = await fundMe.withdraw()
                  const transactionReceipt = await transactionResponse.wait()
                  const { gasUsed, effectiveGasPrice } = transactionReceipt
                  const gasCost = gasUsed.mul(effectiveGasPrice)

                  const endingFundMeBalance = await fundMe.provider.getBalance(
                      fundMe.address
                  )
                  const endingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Assert
                  // Maybe clean up to understand the testing
                  assert.equal(endingFundMeBalance, 0)
                  assert.equal(
                      startingFundMeBalance
                          .add(startingDeployerBalance)
                          .toString(),
                      endingDeployerBalance.add(gasCost).toString()
                  )
              })
              // this test is overloaded. Ideally we'd split it into multiple tests
              // but for simplicity we left it as one
              it("is allows us to withdraw with multiple funders", async () => {
                  // Arrange
                  const accounts = await ethers.getSigners()
                  for (i = 1; i < 6; i++) {
                      const fundMeConnectedContract = await fundMe.connect(
                          accounts[i]
                      )
                      await fundMeConnectedContract.fund({ value: sendValue })
                  }
                  const startingFundMeBalance =
                      await fundMe.provider.getBalance(fundMe.address)
                  const startingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Act
                  const transactionResponse = await fundMe.cheaperWithdraw()
                  // Let's comapre gas costs :)
                  // const transactionResponse = await fundMe.withdraw()
                  const transactionReceipt = await transactionResponse.wait()
                  const { gasUsed, effectiveGasPrice } = transactionReceipt
                  const withdrawGasCost = gasUsed.mul(effectiveGasPrice)
                  console.log(`GasCost: ${withdrawGasCost}`)
                  console.log(`GasUsed: ${gasUsed}`)
                  console.log(`GasPrice: ${effectiveGasPrice}`)
                  const endingFundMeBalance = await fundMe.provider.getBalance(
                      fundMe.address
                  )
                  const endingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)
                  // Assert
                  assert.equal(
                      startingFundMeBalance
                          .add(startingDeployerBalance)
                          .toString(),
                      endingDeployerBalance.add(withdrawGasCost).toString()
                  )
                  // Make a getter for storage variables
                  await expect(fundMe.getFunder(0)).to.be.reverted

                  for (i = 1; i < 6; i++) {
                      assert.equal(
                          await fundMe.getAddressToAmountFunded(
                              accounts[i].address
                          ),
                          0
                      )
                  }
              })
            //   it("Withdraw when there is no fund in the contract", async () => {
            //     await fundMe.withdraw()
            //     await expect(fundMe.withdraw()).to.be.reverted

            //   })

              it("Only allows the owner to withdraw", async function () {
                const accounts = await ethers.getSigners()
                const fundMeConnectedContract = await fundMe.connect(
                    accounts[1]
                )
                await expect(
                    fundMeConnectedContract.withdraw()
                ).to.be.revertedWith("FundMe__NotOwner")
              })
              it("Only allows the owner to withdraw cheaper", async function () {
                const accounts = await ethers.getSigners()
                const fundMeConnectedContract = await fundMe.connect(
                    accounts[1]
                )
                await expect(
                    fundMeConnectedContract.cheaperWithdraw()
                ).to.be.revertedWith("FundMe__NotOwner")
              })

          })

          describe("refund", function () {
            
            beforeEach(async () => {
                const accounts = await ethers.getSigners()
                const fundMeConnectedContract = await fundMe.connect(
                    accounts[1]
                )
                await fundMeConnectedContract.fund({ value: sendValue })
            })
            it("Updates the amount funded data structure after refunding", async function (){
                const refundingAddress = await fundMe.getFunder(0)
                expect(await fundMe.getAddressToAmountFunded(refundingAddress), sendValue)
                await fundMe.refund(refundingAddress)
                expect(await fundMe.getAddressToAmountFunded(refundingAddress), 0)
            })

            it("Only allows the owner to refund", async function () {
                const accounts = await ethers.getSigners()
                const refundingAddress = await fundMe.getFunder(0)
                const fundMeConnectedContract = await fundMe.connect(
                    accounts[1]
                )
                await expect(
                    fundMeConnectedContract.refund(refundingAddress)
                ).to.be.revertedWith("FundMe__NotOwner")
            })
          })

          describe("getOwner", function () {
            it("sets the owner address correctly", async () => {
                const owner = await fundMe.getOwner()
                assert.equal(owner, deployer)
            })
          })

          describe("getVersion", function () {
            it("gets the version correctly", async () => {
                const fundMeVersion = await fundMe.getVersion()
                const mockVersion = await mockV3Aggregator.version()
                assert.equal(fundMeVersion.toString(), mockVersion.toString())
            })
          })
      })
