import sys
from unittest.mock import Mock

class IndividualAddress:
    def __init__(self, addr):
        self.addr = addr
    def __str__(self):
        return str(self.addr)

sys.modules['xknx.telegram.address'] = Mock(IndividualAddress=IndividualAddress)
