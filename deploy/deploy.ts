import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const erc7984 = await deploy("ERC7984Test", {
    from: deployer,
    log: true,
  });

  const staking = await deploy("NightStaking", {
    from: deployer,
    args: [erc7984.address],
    log: true,
  });

  console.log(`ERC7984Test contract: ${erc7984.address}`);
  console.log(`NightStaking contract: ${staking.address}`);
};
export default func;
func.id = "deploy_ftest"; // id required to prevent reexecution
func.tags = ["FTEST"];
